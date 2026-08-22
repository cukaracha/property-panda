import os
import subprocess
import tempfile
from clients import transcribe_client
from clients import budget
from clients.s3_utils import get_s3_object_bytes, put_object, is_file_exists

# Extensions that Transcribe accepts natively (no conversion needed)
TRANSCRIBE_NATIVE = {"mp3", "wav", "m4a", "mp4", "amr", "flac", "ogg", "webm"}

# Leave time after the Transcribe poll to download the transcript + write markdown.
_TRANSCRIBE_TRANSFER_BUDGET = 60


def convert(source_data, source, config) -> str:
    """Convert audio/video to markdown via AWS Transcribe.

    source_data is None for AV files — Transcribe reads directly from S3.
    Non-native formats are converted to mp4 via ffmpeg first.
    """
    try:
        actual_bucket = source.bucket
        actual_key = source.key

        # If format needs conversion, convert to mp4 first
        if source.extension not in TRANSCRIBE_NATIVE:
            actual_key = _convert_to_mp4(source.bucket, source.key, source.base_name)
            print(f"Converted to mp4: s3://{actual_bucket}/{actual_key}")

        # Generate unique job name and transcript output key
        job_name = transcribe_client.generate_job_name(source.base_name)
        transcript_key = f"_temp/transcripts/{job_name}-transcript.json"

        # Start transcription job (pointing at the mp4 if converted)
        transcribe_client.start_job(
            bucket=actual_bucket,
            source_key=actual_key,
            output_key=transcript_key,
            job_name=job_name
        )

        # Poll until complete. Cap the wait to what's left before the Lambda times
        # out (minus a transfer budget), so a long media file fails cleanly rather
        # than getting killed mid-write. Hard ceiling stays 10 min.
        poll_timeout = int(min(600, max(30, budget.remaining_seconds() - _TRANSCRIBE_TRANSFER_BUDGET)))
        transcribe_client.poll_until_complete(job_name, timeout_seconds=poll_timeout)

        # Download transcript JSON from S3
        transcript_data = transcribe_client.get_transcript(actual_bucket, transcript_key)

        # Format transcript as markdown
        return _format_transcript(transcript_data, source.base_name)

    except Exception as e:
        print(f"Error converting audio/video: {e}")
        raise


def _convert_to_mp4(bucket: str, source_key: str, base_name: str) -> str:
    """Convert a non-mp4 video to mp4 via ffmpeg, upload to S3, return new S3 key."""
    # Build the mp4 key (same path, .mp4 extension)
    s3_path, _, ext = source_key.rpartition('.')
    mp4_key = f"{s3_path}.mp4"

    # Skip if mp4 already exists in S3
    if is_file_exists(bucket, mp4_key):
        print(f"MP4 already exists: s3://{bucket}/{mp4_key}")
        return mp4_key

    # Download source file
    source_bytes = get_s3_object_bytes(bucket, source_key)

    with tempfile.TemporaryDirectory() as tmp_dir:
        input_path = os.path.join(tmp_dir, f"input.{ext}")
        output_path = os.path.join(tmp_dir, f"{base_name}.mp4")

        # Write source to temp file
        with open(input_path, 'wb') as f:
            f.write(source_bytes)

        # Convert with ffmpeg, capped to the remaining Lambda budget (ceiling 5 min).
        print(f"Converting {source_key} to mp4 via ffmpeg")
        ffmpeg_timeout = int(min(300, max(30, budget.remaining_seconds())))
        subprocess.run(
            ['ffmpeg', '-i', input_path, output_path],
            check=True, capture_output=True, timeout=ffmpeg_timeout
        )
        print(f"Conversion successful: {source_key} -> mp4")

        # Upload converted file to S3
        with open(output_path, 'rb') as f:
            put_object(bucket, mp4_key, f.read(), 'video/mp4')

    return mp4_key


def _format_transcript(transcript_data: dict, filename: str) -> str:
    """Convert Amazon Transcribe JSON output to markdown with timestamps."""
    markdown_lines = [
        f"# {filename} Transcript",
        ""
    ]

    results = transcript_data.get('results', {})
    audio_segments = results.get('audio_segments', [])

    for segment in audio_segments:
        start_time = segment.get('start_time', '0')
        end_time = segment.get('end_time', '0')
        transcript = segment.get('transcript', '')
        speaker = segment.get('speaker')

        start_formatted = _format_timestamp(start_time)
        end_formatted = _format_timestamp(end_time)
        timestamp_range = f"[{start_formatted} - {end_formatted}]"

        if speaker:
            speaker_label = f" {speaker.replace('spk_', 'Speaker ')}:"
        else:
            speaker_label = ""

        if transcript:
            markdown_lines.append(f"{timestamp_range}{speaker_label} {transcript}")
            markdown_lines.append("")

    if not audio_segments:
        markdown_lines.append("*No audio segments found in transcript*")

    return '\n'.join(markdown_lines)


def _format_timestamp(seconds) -> str:
    """Convert seconds (float or string) to HH:MM:SS format."""
    try:
        seconds = float(seconds)
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    except (ValueError, TypeError):
        return "00:00:00"
