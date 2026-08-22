import boto3
import time
from datetime import datetime


def start_job(bucket: str, source_key: str, output_key: str, job_name: str, language_code: str = 'en-US') -> dict:
    """
    Start an Amazon Transcribe job.

    Args:
        bucket: S3 bucket name
        source_key: S3 key of the audio/video file
        output_key: S3 key for the transcript output
        job_name: Unique transcription job name
        language_code: Language code (default: en-US)

    Returns:
        Transcribe API response
    """
    transcribe = boto3.client('transcribe')

    s3_uri = f"s3://{bucket}/{source_key}"

    print(f"Starting transcription job: {job_name}")
    print(f"Source: {s3_uri}")
    print(f"Output: s3://{bucket}/{output_key}")

    response = transcribe.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={
            'MediaFileUri': s3_uri
        },
        OutputBucketName=bucket,
        OutputKey=output_key,
        LanguageCode=language_code,
        Settings={
            'ShowSpeakerLabels': True,
            'MaxSpeakerLabels': 10,
            'ShowAlternatives': False
        }
    )

    print(f"Transcription job started: {response['TranscriptionJob']['TranscriptionJobStatus']}")
    return response


def poll_until_complete(job_name: str, timeout_seconds: int = 600, poll_interval: int = 10) -> str:
    """
    Poll a transcription job until it completes or times out.

    Args:
        job_name: Transcription job name
        timeout_seconds: Maximum wait time in seconds (default: 600 = 10 min)
        poll_interval: Seconds between polls (default: 10)

    Returns:
        Final job status

    Raises:
        TimeoutError: If job doesn't complete within timeout
        RuntimeError: If job fails
    """
    transcribe = boto3.client('transcribe')
    elapsed = 0

    while elapsed < timeout_seconds:
        response = transcribe.get_transcription_job(
            TranscriptionJobName=job_name
        )

        status = response['TranscriptionJob']['TranscriptionJobStatus']
        print(f"Transcription job '{job_name}' status: {status} (elapsed: {elapsed}s)")

        if status == 'COMPLETED':
            return status

        if status == 'FAILED':
            reason = response['TranscriptionJob'].get('FailureReason', 'Unknown error')
            raise RuntimeError(f"Transcription job failed: {reason}")

        time.sleep(poll_interval)
        elapsed += poll_interval

    raise TimeoutError(f"Transcription job '{job_name}' timed out after {timeout_seconds}s")


def get_transcript(bucket: str, transcript_key: str) -> dict:
    """
    Download and parse a transcript JSON from S3.

    Args:
        bucket: S3 bucket name
        transcript_key: S3 key of the transcript JSON

    Returns:
        Parsed transcript data as dict
    """
    import json

    s3 = boto3.client('s3')

    print(f"Downloading transcript from s3://{bucket}/{transcript_key}")

    response = s3.get_object(Bucket=bucket, Key=transcript_key)
    transcript_content = response['Body'].read().decode('utf-8')
    transcript_data = json.loads(transcript_content)

    return transcript_data


def generate_job_name(base_name: str) -> str:
    """
    Generate a unique, Transcribe-compliant job name.

    Args:
        base_name: Base name for the job (e.g., filename without extension)

    Returns:
        Sanitized job name (alphanumeric + hyphens, max 200 chars)
    """
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    job_name = f"{base_name}-{timestamp}"

    # Sanitize: alphanumeric and hyphens only, max 200 chars
    job_name = ''.join(c if c.isalnum() or c == '-' else '-' for c in job_name)
    job_name = job_name[:200]

    return job_name
