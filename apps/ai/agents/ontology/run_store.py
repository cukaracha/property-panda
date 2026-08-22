"""The build's durable trail on the ontology jobs table.

`shared/status.py` already owns the job row's control fields — stage, status,
progress, outputs — and the control Lambdas read them. This module adds the one
thing the retired pipeline had no need for: a bounded tail of what the agent
actually did, so a build that stalls or fails can be diagnosed from the row rather
than from CloudWatch.

The tail is capped and each entry truncated, because the row is read by the
frontend's poller on every tick and DynamoDB items are limited to 400 KB. It is a
diagnostic trail, not a transcript.

It also owns `agentStatus`: the one attribute the agent writes for the state machine
to read, and the backstop that guarantees a run cannot leave that attribute unset —
see `ensure_agent_terminal` for why the build boundary needs one.
"""

import time

import boto3
from botocore.exceptions import ClientError

from shared import models

MAX_TRAIL_ENTRIES = 200
MAX_ENTRY_CHARS = 500
# The trail is written back as one attribute, so a flush per event would cost a
# write per model turn. Coalescing to this interval keeps the row fresh enough for
# a poller without turning the diagnostic trail into the build's dominant cost.
FLUSH_INTERVAL_SECONDS = 5


class RunStore:
    def __init__(self, table_name: str, job_id: str, region: str = None) -> None:
        self.job_id = job_id
        self._table = boto3.resource('dynamodb', region_name=region).Table(table_name)
        self._trail = []
        self._last_flush = 0.0

    def append_event(self, event: dict) -> None:
        """Add one event to the trail, flushing the bounded tail on the next interval."""
        entry = {
            'type': event.get('type', 'message'),
            'content': str(event.get('content', ''))[:MAX_ENTRY_CHARS],
            'at': int(time.time()),
        }
        self._trail.append(entry)
        del self._trail[:-MAX_TRAIL_ENTRIES]

        # A status event ends a run, so it is flushed immediately — the trail is
        # most useful precisely when the build stopped.
        if entry['type'] == 'status' or time.monotonic() - self._last_flush >= FLUSH_INTERVAL_SECONDS:
            self.flush()

    def flush(self) -> None:
        self._last_flush = time.monotonic()
        self._flush()

    def set_agent_status(self, agent_status: str, reason: str = '') -> None:
        """Record how the agent's stage ended. The state machine polls exactly this.

        It is not the model's word. `main` verifies the artifacts CONSOLIDATE was
        supposed to produce and only then writes `consolidated`, the same discipline
        the retired `finalize_build` applied to the outputs.
        """
        self._table.update_item(
            Key={'jobId': self.job_id},
            UpdateExpression='SET agentStatus = :a, agentError = :e, updatedAt = :now',
            ExpressionAttributeValues={
                ':a': agent_status,
                ':e': str(reason)[:2000],
                ':now': int(time.time()),
            },
        )

    def ensure_agent_terminal(self, reason: str) -> bool:
        """Record a failed agent stage unless one was already recorded. Returns whether it fired.

        A run that simply stops — it gives up, hits its turn ceiling, or returns
        without writing anything — would otherwise leave `agentStatus` unset, and the
        state machine would poll for it until the two-hour ceiling. The condition is
        what makes this safe to call unconditionally at the end of every run.

        It is deliberately scoped to `agentStatus` and not to `status`. The agent no
        longer marks a build terminal: EMIT does, in a Lambda, minutes after the agent
        has exited. A backstop conditioned on `status` would therefore fire on every
        successful run and fail the build before CANONICALIZE had even started.
        """
        try:
            self._table.update_item(
                Key={'jobId': self.job_id},
                UpdateExpression='SET agentStatus = :a, agentError = :e, updatedAt = :now',
                ConditionExpression='attribute_not_exists(agentStatus)',
                ExpressionAttributeValues={
                    ':a': models.AGENT_FAILED,
                    ':e': str(reason)[:2000],
                    ':now': int(time.time()),
                },
            )
            return True
        except ClientError as error:
            if error.response['Error']['Code'] == 'ConditionalCheckFailedException':
                return False
            raise

    def _flush(self) -> None:
        self._table.update_item(
            Key={'jobId': self.job_id},
            UpdateExpression='SET trail = :t, updatedAt = :now',
            ExpressionAttributeValues={':t': self._trail, ':now': int(time.time())},
        )
