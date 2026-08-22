from typing import Union, Dict
from converters import pdf, document, web, text, image, audio_video


EXTENSION_MAP = {
    # PDF
    "pdf": pdf.convert,

    # Documents (LibreOffice → PDF → Mistral OCR)
    "docx": document.convert, "doc": document.convert, "odt": document.convert,

    # Presentations (LibreOffice → PDF → Mistral OCR)
    "pptx": document.convert, "ppt": document.convert, "odp": document.convert,

    # Spreadsheets (LibreOffice → PDF → Mistral OCR)
    "xlsx": document.convert, "xls": document.convert, "ods": document.convert,

    # Web (WeasyPrint → PDF → Mistral OCR)
    "html": web.convert, "htm": web.convert,

    # Text formats (native parsing)
    "txt": text.convert_text, "rtf": text.convert_text,
    "csv": text.convert_csv, "tsv": text.convert_csv,
    "json": text.convert_json, "xml": text.convert_xml,
    "md": text.convert_markdown, "markdown": text.convert_markdown,

    # Images (Bedrock / Claude vision)
    "png": image.convert, "jpg": image.convert, "jpeg": image.convert,
    "gif": image.convert, "bmp": image.convert,

    # Audio/Video (AWS Transcribe)
    "mp3": audio_video.convert, "wav": audio_video.convert,
    "m4a": audio_video.convert, "mp4": audio_video.convert,
    "amr": audio_video.convert, "flac": audio_video.convert,
    "ogg": audio_video.convert, "webm": audio_video.convert,

    # Audio/Video requiring ffmpeg conversion to mp4 first
    "mov": audio_video.convert, "avi": audio_video.convert,
    "mkv": audio_video.convert, "wmv": audio_video.convert,
    "m4v": audio_video.convert, "3gp": audio_video.convert,
}

SUPPORTED_EXTENSIONS = set(EXTENSION_MAP.keys())

DOCUMENT_EXTENSIONS = {
    "pdf", "docx", "doc", "odt", "pptx", "ppt", "odp",
    "xlsx", "xls", "ods", "html", "htm", "txt", "rtf",
    "csv", "tsv", "json", "xml", "md", "markdown"
}
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp"}
AV_EXTENSIONS = {"mp3", "wav", "m4a", "mp4", "amr", "flac", "ogg", "webm",
                 "mov", "avi", "mkv", "wmv", "m4v", "3gp"}

# Formats that need ffmpeg conversion to mp4 before Transcribe
AV_CONVERT_EXTENSIONS = {"mov", "avi", "mkv", "wmv", "m4v", "3gp"}


def get_file_category(extension: str) -> str:
    """Determine file category from extension."""
    ext = extension.lower()
    if ext in DOCUMENT_EXTENSIONS:
        return "document"
    elif ext in IMAGE_EXTENSIONS:
        return "image"
    elif ext in AV_EXTENSIONS:
        return "audio_video"
    else:
        raise ValueError(f"Unsupported file extension: {extension}")


def convert(source_data, source, config) -> Union[str, Dict[int, str]]:
    """
    Dispatch to the appropriate converter based on file extension.

    Args:
        source_data: File bytes (or None for audio/video)
        source: Source dataclass with file metadata
        config: Config dataclass with prompts and settings

    Returns:
        str for single-page output, Dict[int, str] for multi-page output
    """
    converter_fn = EXTENSION_MAP.get(source.extension)
    if not converter_fn:
        raise ValueError(f"Unsupported file extension: {source.extension}")

    return converter_fn(source_data, source, config)
