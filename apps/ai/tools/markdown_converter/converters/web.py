from typing import Dict
from io import BytesIO

from weasyprint import HTML, CSS
from converters import pdf


def convert(source_data: bytes, source, config) -> Dict[int, str]:
    """Convert HTML to markdown via WeasyPrint PDF conversion."""
    try:
        html_content = source_data.decode('utf-8', errors='ignore')

        # Create PDF in memory
        pdf_buffer = BytesIO()

        HTML(string=html_content).write_pdf(
            pdf_buffer,
            stylesheets=[CSS(string='@page { size: A4; margin: 1cm; }')]
        )

        pdf_bytes = pdf_buffer.getvalue()

        # Delegate to PDF converter
        return pdf.convert(pdf_bytes, source, config)

    except Exception as e:
        print(f"Error converting HTML via WeasyPrint: {e}")
        raise
