"""The raw type and predicate vocabulary the corpus produced, aggregated once.

CONSOLIDATE looked at this three times: to show the raw vocabulary, to cluster it,
and again to check what the committed schema left unmapped. Each look walked every
element file in the build, so the cost of designing a schema grew with the corpus
even though the vocabulary itself does not: a thousand pages and ten thousand pages
produce roughly the same few hundred raw strings.

It is aggregated once now, straight off the element stream, and written as a small
artifact the stage reads instead. What is kept is exactly what the charter needs to
judge a merge: how widely a type is attested, what it looks like in the text, how
often a predicate fires, and the type pair it most commonly joins.
"""

from collections import Counter

from . import artifacts

VOCAB_NAME = 'consolidate/vocab.json'

TYPE_EXAMPLES = 10
PRED_EXAMPLES = 5


def new_totals() -> dict:
    return {'types': {}, 'predicates': {}}


def add(totals: dict, element: dict) -> None:
    """Fold one element's raw vocabulary into the running totals, in place."""
    types, preds = totals['types'], totals['predicates']
    for ent in element.get('entities', []):
        agg = types.setdefault(ent['type'], {'pages': set(), 'examples': []})
        agg['pages'].add(ent['page_id'])
        if ent['name'] not in agg['examples'] and len(agg['examples']) < TYPE_EXAMPLES:
            agg['examples'].append(ent['name'])
    for rel in element.get('relations', []):
        agg = preds.setdefault(rel['p'], {'count': 0, 'pairs': Counter(), 'examples': []})
        agg['count'] += 1
        agg['pairs'][(rel['s_type'], rel['o_type'])] += 1
        if len(agg['examples']) < PRED_EXAMPLES:
            agg['examples'].append(f"{rel['s']} {rel['p']} {rel['o']}")


def to_artifact(totals: dict) -> dict:
    """The JSON-safe form: sets become counts and Counters become the commonest pair."""
    return {
        'types': [
            {'raw': name, 'pages': len(agg['pages']), 'examples': agg['examples']}
            for name, agg in sorted(totals['types'].items())
        ],
        'predicates': [
            {
                'raw': name,
                'count': agg['count'],
                'commonestPair': list(agg['pairs'].most_common(1)[0][0]),
                'examples': agg['examples'],
            }
            for name, agg in sorted(totals['predicates'].items())
        ],
    }


def aggregate(elements) -> dict:
    """Summarize an element stream into the artifact form in one pass."""
    totals = new_totals()
    for element in elements:
        add(totals, element)
    return to_artifact(totals)


def read(run_prefix: str) -> dict:
    """The precomputed vocabulary, or an aggregation over the elements if it is missing."""
    uri = artifacts.resolve(run_prefix, VOCAB_NAME)
    if artifacts.exists(uri):
        return artifacts.read_json(uri)

    from . import elements

    return aggregate(elements.stream(run_prefix))
