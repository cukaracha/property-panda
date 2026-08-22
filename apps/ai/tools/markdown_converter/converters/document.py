import os
import subprocess
import tempfile
from typing import Dict

from converters import pdf


# Map of extensions to LibreOffice temp file suffixes
EXTENSION_SUFFIX_MAP = {
    # Documents
    "docx": ".docx", "doc": ".doc", "odt": ".odt",
    # Presentations
    "pptx": ".pptx", "ppt": ".ppt", "odp": ".odp",
    # Spreadsheets
    "xlsx": ".xlsx", "xls": ".xls", "ods": ".ods",
}


def convert(source_data: bytes, source, config) -> Dict[int, str]:
    """Convert document/presentation/spreadsheet to markdown via LibreOffice PDF conversion."""
    try:
        suffix = EXTENSION_SUFFIX_MAP.get(source.extension, f".{source.extension}")

        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_file:
            tmp_file.write(source_data)
            tmp_path = tmp_file.name

        # Derive expected PDF output path
        pdf_path = os.path.splitext(tmp_path)[0] + '.pdf'

        # Convert to PDF using LibreOffice
        libreoffice_cmd = [
            'libreoffice7.6',
            '--headless',
            '--invisible',
            '--nodefault',
            '--nolockcheck',
            '--nologo',
            '--norestore',
            '--convert-to', 'pdf',
            '--outdir', '/tmp',
            tmp_path
        ]

        result = subprocess.run(
            libreoffice_cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode != 0:
            raise Exception(f"LibreOffice conversion failed: {result.stderr}")

        # Read the converted PDF
        with open(pdf_path, 'rb') as pdf_file:
            pdf_bytes = pdf_file.read()

        # Clean up temporary files
        try:
            os.unlink(tmp_path)
            os.unlink(pdf_path)
        except Exception as e:
            print(f"Warning: Could not delete temp files: {e}")

        # Delegate to PDF converter
        return pdf.convert(pdf_bytes, source, config)

    except Exception as e:
        print(f"Error converting {source.extension} via LibreOffice: {e}")
        raise
