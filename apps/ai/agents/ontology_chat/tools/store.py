"""The deterministic backend behind the five primitives. No model calls at all.

Everything a search needs about the graph is in one artifact, `index/page_graph.json`,
which EMIT writes: page to its relations, relation to its endpoints, node back to
every page it appears on. It is loaded once per question and held for the life of the
request, so a subagent walking six hops re-reads nothing.

Page TEXT is deliberately not in it. Text is fetched per page, on demand, only for
the pages a search actually reaches — which is the whole reason `neighbor_pages`
returns bare ids and `retrieve_pages` is a separate call.

The neighbour cut lives here too. A hub node can sit on hundreds of pages, so
returning all of them would flood the subagent that asked; the cut ranks candidates
by the relations that reach them and keeps the strongest. It is a bound on volume,
not a judgement about relevance — that judgement is query-specific and belongs to
the subagent, which is why nothing here has ever seen the question.
"""

import json

import boto3

# How many neighbour pages one hop may return. Bounds the fan-out of a hub node
# without bounding how far a subagent can walk.
NEIGHBOR_CUT = 30

# Pages one retrieve_pages call may return. A page can be 12,000 characters, so this
# is the difference between a subagent reading a frontier and drowning in it.
MAX_PAGES_PER_CALL = 10

# Raw window hits to ask the index for per page wanted. Windows overlap and several
# from one page routinely score together, so over-fetching is what makes the
# deduped page list actually reach topK distinct pages.
HITS_PER_PAGE = 4

EVIDENCE_CHARS = 240
SNIPPET_CHARS = 400


class BuildStore:
    def __init__(self, ctx):
        self.ctx = ctx
        self._s3 = boto3.client('s3', region_name=ctx.region)
        self._s3vectors = boto3.client('s3vectors', region_name=ctx.region)
        self._bedrock = boto3.client('bedrock-runtime', region_name=ctx.region)
        self._graph = None
        self._pages: dict = {}

    # --- artifacts ---------------------------------------------------------

    def _read_json(self, rel_path: str):
        key = f"{self.ctx.user_prefix}{rel_path}"
        body = self._s3.get_object(Bucket=self.ctx.gold_bucket, Key=key)['Body'].read()
        return json.loads(body)

    @property
    def graph(self) -> dict:
        if self._graph is None:
            self._graph = self._read_json('index/page_graph.json')
        return self._graph

    def page(self, page_id: str) -> dict:
        if page_id not in self._pages:
            self._pages[page_id] = self._read_json(f"pages/{page_id}.json")
        return self._pages[page_id]

    def page_label(self, page_id: str) -> str:
        """How a reader would name this page: `Q3 Report-pg3`.

        Built from the page graph, which already carries the title and number, so
        labelling costs nothing and works on ontologies built before it existed.
        A page with no recorded number is named by its document rather than given an
        invented one, and an id the graph does not know is returned unchanged: a
        label is for reading, and neither case is worth failing a search over.
        """
        page = self.graph['pages'].get(page_id)
        if page is None:
            return page_id
        title = (page.get('docTitle') or page.get('docId') or '').rsplit('.', 1)[0].strip()
        number = page.get('pageNumber')
        if not title:
            return page_id
        return f"{title}-pg{number}" if number is not None else f"{title} ({page_id})"

    # --- vector search -----------------------------------------------------

    def _embed(self, text: str):
        body = json.dumps({'inputText': text or ' ', 'dimensions': 1024, 'normalize': True})
        response = self._bedrock.invoke_model(modelId='amazon.titan-embed-text-v2:0', body=body)
        return json.loads(response['body'].read())['embedding']

    def search(self, query: str, top_k: int) -> list:
        """Window hits deduped to their parent pages, best first.

        The filter pins both the build and its owner. The build id alone would be
        enough to keep results correct; the sub is there so a bug that let a foreign
        build id through would still return nothing.

        It is the owner's sub rather than the caller's, because that is what hydration
        wrote into each window's metadata. A published ontology is searched in place,
        so filtering on the reader would match nothing at all.
        """
        hits = self._s3vectors.query_vectors(
            vectorBucketName=self.ctx.vector_bucket,
            indexName=self.ctx.vector_index,
            topK=max(top_k * HITS_PER_PAGE, top_k),
            queryVector={'float32': self._embed(query)},
            filter={
                '$and': [
                    {'buildId': {'$eq': self.ctx.build_id}},
                    {'userSub': {'$eq': self.ctx.owner_sub}},
                ]
            },
            returnMetadata=True,
            returnDistance=True,
        ).get('vectors', [])

        by_page: dict = {}
        for hit in hits:
            metadata = hit.get('metadata') or {}
            page_id = metadata.get('pageId')
            if not page_id:
                continue
            # Cosine distance, so lower is better; 1 - distance is the similarity.
            similarity = round(1.0 - float(hit.get('distance', 1.0)), 4)
            existing = by_page.get(page_id)
            if existing is None or similarity > existing['similarity']:
                by_page[page_id] = {
                    'pageId': page_id,
                    'docId': metadata.get('docId', ''),
                    'docTitle': metadata.get('docTitle', ''),
                    'similarity': similarity,
                    'snippet': (metadata.get('text') or '')[:SNIPPET_CHARS],
                    'windows': (existing or {}).get('windows', 0) + 1,
                }
            else:
                existing['windows'] += 1

        ranked = sorted(by_page.values(), key=lambda p: p['similarity'], reverse=True)
        for page in ranked:
            page['pageNumber'] = self.graph['pages'].get(page['pageId'], {}).get('pageNumber')
            page['pageLabel'] = self.page_label(page['pageId'])
        return ranked[:top_k]

    # --- graph walks -------------------------------------------------------

    def relations(self, page_ids: list) -> list:
        """One line per relation on each page, with both endpoints named and identified."""
        graph = self.graph
        rows = []
        for page_id in page_ids:
            page = graph['pages'].get(page_id)
            if page is None:
                continue
            for edge_id in page['edges']:
                edge = graph['edges'].get(edge_id)
                if edge is None:
                    continue
                source = graph['nodes'].get(edge['s'], {})
                target = graph['nodes'].get(edge['t'], {})
                source_name = source.get('name', edge['s'])
                target_name = target.get('name', edge['t'])
                rows.append({
                    'edgeId': edge_id,
                    'pageId': page_id,
                    'pageLabel': self.page_label(page_id),
                    'relation': f"{source_name} —{edge['label']}→ {target_name}",
                    'source': {'id': edge['s'], 'name': source_name,
                               'label': source.get('label', '')},
                    'target': {'id': edge['t'], 'name': target_name,
                               'label': target.get('label', '')},
                    'qualifier': edge.get('q', ''),
                    'time': edge.get('tm', ''),
                    'evidence': (edge.get('ev') or '')[:EVIDENCE_CHARS],
                })
        return rows

    def neighbors(self, node_ids: list, exclude_page_ids: list) -> dict:
        """Pages one hop away through the given nodes, ranked and cut, ids only.

        A page scores the sum over every relation that reaches it of that relation's
        weight times the idf of its FAR node — the endpoint the page adds that the
        caller did not already name. idf is the term that matters: it suppresses hub
        nodes, which is the failure mode a shared-identifier walk actually has.
        """
        graph = self.graph
        wanted = {node_id for node_id in node_ids if node_id in graph['nodes']}
        if not wanted:
            return {'pageIds': [], 'candidates': 0, 'returned': 0, 'truncated': False,
                    'note': 'none of those node ids are in this ontology'}

        excluded = set(exclude_page_ids or [])
        candidates = set()
        for node_id in wanted:
            candidates.update(graph['nodes'][node_id].get('pages', []))
        candidates -= excluded

        scored = []
        for page_id in candidates:
            page = graph['pages'].get(page_id)
            if page is None:
                continue
            score = 0.0
            for edge_id in page['edges']:
                edge = graph['edges'].get(edge_id)
                if edge is None:
                    continue
                endpoints = (edge['s'], edge['t'])
                if not any(endpoint in wanted for endpoint in endpoints):
                    continue
                far = [e for e in endpoints if e not in wanted]
                if not far:
                    # Both ends were named by the caller: still evidence, scored on
                    # the more discriminative of the two.
                    far = list(endpoints)
                idf = max(graph['nodes'].get(e, {}).get('idf', 0.0) for e in far)
                score += float(edge.get('w', 0) or 0) * float(idf)
            scored.append((score, page_id))

        scored.sort(key=lambda pair: (-pair[0], pair[1]))
        kept = [page_id for _, page_id in scored[:NEIGHBOR_CUT]]
        return {
            'pageIds': kept,
            # Beside the ids rather than replacing them: the ids are what goes back
            # into retrieve_pages, and the labels are what a report says out loud.
            'pageLabels': {page_id: self.page_label(page_id) for page_id in kept},
            'candidates': len(scored),
            'returned': len(kept),
            'truncated': len(scored) > len(kept),
        }

    # --- overview ----------------------------------------------------------

    def overview(self) -> dict:
        graph = self.graph
        pages, nodes, edges = graph['pages'], graph['nodes'], graph['edges']

        documents: dict = {}
        for page in pages.values():
            documents.setdefault(page['docTitle'] or page['docId'], 0)
            documents[page['docTitle'] or page['docId']] += 1

        labels: dict = {}
        for node in nodes.values():
            labels[node['label']] = labels.get(node['label'], 0) + 1

        predicates: dict = {}
        degree: dict = {}
        for edge in edges.values():
            predicates[edge['label']] = predicates.get(edge['label'], 0) + 1
            degree[edge['s']] = degree.get(edge['s'], 0) + 1
            degree[edge['t']] = degree.get(edge['t'], 0) + 1

        prominent = sorted(
            (
                {'nodeId': node_id, 'name': nodes[node_id]['name'],
                 'label': nodes[node_id]['label'], 'role': nodes[node_id]['role'],
                 'degree': count, 'pages': len(nodes[node_id].get('pages', []))}
                for node_id, count in degree.items() if node_id in nodes
            ),
            key=lambda n: -n['degree'],
        )[:25]

        return {
            'buildId': self.ctx.build_id,
            'title': self.ctx.title,
            'documents': [{'title': title, 'pages': count}
                          for title, count in sorted(documents.items())],
            'pages': len(pages),
            'nodes': len(nodes),
            'edges': len(edges),
            'nodesByLabel': dict(sorted(labels.items(), key=lambda kv: -kv[1])[:25]),
            'predicates': dict(sorted(predicates.items(), key=lambda kv: -kv[1])[:25]),
            'mostConnected': prominent,
        }
