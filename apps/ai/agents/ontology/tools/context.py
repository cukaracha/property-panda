"""The per-build context every tool closes over.

One `RunContext` is built per invocation and captured by every tool through the
server factory, so each run has one run prefix, one set of lake bucket names, and one
job row. Every stage reads what the previous stage wrote at a deterministic key under
`run_prefix`, so no state crosses a payload boundary however the stages are split
between the state machine and this runtime.

The context is also where tenancy stops being advisory. `run_prefix` is derived
once from the verified Cognito sub the start Lambda passed in, so no tool takes a
bucket or prefix from the model — a run can only ever read and write inside the
owner's own `users/{sub}/{buildId}/` prefix.

An extract invocation additionally carries the page ids it was handed and collects
the pages it actually recorded. That set, not the model's closing summary, is what
the invocation reports back to the state machine, so a batch cannot claim a page it
never wrote. `failure_reason` is the same idea for CONSOLIDATE: the model states why
it gave up, and the invocation still decides whether the stage failed by checking
whether the artifacts exist.
"""


class RunContext:
    def __init__(
        self,
        job_id: str,
        user_sub: str,
        email: str,
        markdown_keys: list,
        *,
        failed_docs: list = None,
        page_ids: list = None,
        silver_bucket: str,
        gold_bucket: str,
        region: str,
    ) -> None:
        self.job_id = job_id
        self.user_sub = user_sub
        self.email = email
        self.markdown_keys = list(markdown_keys)
        self.failed_docs = list(failed_docs or [])
        self.page_ids = list(page_ids or [])
        self.recorded_pages: set = set()
        self.vocab = None
        self.failure_reason = ''
        self.silver_bucket = silver_bucket
        self.gold_bucket = gold_bucket
        self.region = region

    @property
    def user_prefix(self) -> str:
        """The owner's key prefix for this build, shared by all three lake layers."""
        return f"users/{self.user_sub}/{self.job_id}/"

    @property
    def run_prefix(self) -> str:
        """Gold run prefix — every intermediate artifact and every flat output."""
        return f"s3://{self.gold_bucket}/{self.user_prefix}"

    @property
    def silver_prefix(self) -> str:
        """Silver prefix this build's converted markdown was written into."""
        return f"s3://{self.silver_bucket}/{self.user_prefix}"
