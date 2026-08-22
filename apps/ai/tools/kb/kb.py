"""
Course Knowledge Base Tool Lambda.

Registered as the AgentCore Gateway MCP tool `course_knowledge_base`: given a
topicId and a query, it runs a Bedrock Knowledge Base Retrieve scoped to the
unit's data source and returns the top-K matching passages.

The topicId maps to a Bedrock data source id via the DynamoDB table named in
KB_TOPIC_TABLE; retrieval is scoped to that data source with a metadata filter on
the reserved `x-amz-bedrock-kb-data-source-id` key, so a unit only ever sees its
own lesson materials. KB_ID is the shared knowledge base id.

MCP-only: the gateway passes the raw tool args as `event` and turns the returned
dict into the MCP tool result, so this returns a BARE dict (no {statusCode, body}
envelope). There is no REST entrypoint.
"""

import os

import boto3

_bedrock_runtime = boto3.client('bedrock-agent-runtime')
_dynamodb = boto3.resource('dynamodb')

DEFAULT_TOP_K = 10
MAX_TOP_K = 100


def clamp_top_k(raw):
    try:
        k = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_TOP_K
    return max(1, min(k, MAX_TOP_K))


def lookup_data_source_id(topic_id):
    """Return the Bedrock data source id mapped to topic_id, or None if unmapped."""
    table = _dynamodb.Table(os.environ['KB_TOPIC_TABLE'])
    item = table.get_item(Key={'topicId': topic_id}).get('Item')
    return item.get('dataSourceId') if item else None


def shape_results(retrieval_results):
    results = []
    for r in retrieval_results:
        location = r.get('location') or {}
        s3 = location.get('s3Location') or {}
        results.append({
            'text': (r.get('content') or {}).get('text', ''),
            'score': r.get('score'),
            'source': s3.get('uri', ''),
        })
    # Preserve Bedrock's ordering. The Retrieve API returns retrievalResults already
    # ranked best-match-first, and `score` is a Bedrock *relevance* score (higher = more
    # relevant per the API docs), NOT a raw vector distance. Do NOT re-sort by score here:
    # an ascending sort (which the old pgvector code used, assuming score was a distance
    # where lower = closer) would reverse the ranking under S3 Vectors and surface the
    # worst matches first.
    return results


def main(topic_id, query, top_k):
    """Resolve the unit's data source and retrieve top-K chunks scoped to it."""
    data_source_id = lookup_data_source_id(topic_id)
    if not data_source_id:
        return {'results': [], 'state': 'unknown_unit'}

    resp = _bedrock_runtime.retrieve(
        knowledgeBaseId=os.environ['KB_ID'],
        retrievalQuery={'text': query},
        retrievalConfiguration={
            'vectorSearchConfiguration': {
                'numberOfResults': top_k,
                'filter': {
                    'equals': {
                        'key': 'x-amz-bedrock-kb-data-source-id',
                        'value': data_source_id,
                    }
                },
            }
        },
    )

    results = shape_results(resp.get('retrievalResults', []))
    return {'results': results, 'state': 'ok' if results else 'no_results'}


def lambda_handler(event, context):
    # AgentCore Gateway tool path: the gateway passes the raw tool args as `event`
    # and turns the returned value into the MCP tool result, so return a bare dict.
    topic_id = (event.get('topicId') or '').strip()
    query = (event.get('query') or '').strip()
    if not topic_id or not query:
        return {'error': 'topicId and query are required'}

    top_k = clamp_top_k(event.get('topK', DEFAULT_TOP_K))

    try:
        return main(topic_id, query, top_k)
    except Exception as e:
        print(f'Error querying course knowledge base: {str(e)}')
        return {'error': str(e)}
