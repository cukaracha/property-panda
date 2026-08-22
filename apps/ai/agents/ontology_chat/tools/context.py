"""The per-question context every tool closes over.

One `ChatContext` is built per invocation in `main.answer` and captured by every
tool through the server factory, so the orchestrator and both subagent roles share
one build, one gold prefix, and one vector index.

This is where tenancy stops being advisory. `user_sub` comes from the Cognito access
token the runtime's JWT authorizer already verified, and `build_id` is checked
against the job row before a context is built at all. Every path a tool touches is
derived from the resulting pair, so no tool takes a bucket, a prefix, or a build id
from the model: a role can only ever read inside `users/{ownerSub}/{buildId}/`, and
the vector filter is pinned to the same pair.

`owner_sub` is separate from `user_sub` because publishing an ontology moves nothing.
A shared build's pages, elements and vectors keep the sub of whoever built them, so
the reader's own sub would name a prefix with nothing in it and a vector filter that
matches no window. The authorization decision is made once, in main._load_build; what
reaches here is the layout that decision resolved to.
"""


class ChatContext:
    def __init__(
        self,
        build_id: str,
        user_sub: str,
        title: str = '',
        *,
        owner_sub: str = '',
        gold_bucket: str,
        vector_bucket: str,
        vector_index: str,
        region: str,
    ) -> None:
        self.build_id = build_id
        self.user_sub = user_sub
        self.owner_sub = owner_sub or user_sub
        self.title = title
        self.gold_bucket = gold_bucket
        self.vector_bucket = vector_bucket
        self.vector_index = vector_index
        self.region = region

    @property
    def user_prefix(self) -> str:
        """The owner's key prefix for this build — the same one the build wrote to."""
        return f"users/{self.owner_sub}/{self.build_id}/"

    @property
    def run_prefix(self) -> str:
        """Gold run prefix holding the pages and the page graph."""
        return f"s3://{self.gold_bucket}/{self.user_prefix}"
