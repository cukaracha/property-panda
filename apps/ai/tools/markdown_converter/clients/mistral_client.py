from mistralai.client import Mistral
from mistralai.client.models import OCRResponse
from pathlib import Path
import time
import os


class APILimitExceededError(Exception):
    """Raised when the API rate limit is exceeded."""
    pass


def invoke_pdf_ocr(pdf_filepath: str, retries: int = 0) -> OCRResponse:
    '''
    Uses Mistral OCR to process a PDF.
    Returns the response OCRResponse object.
    '''

    if retries > 5:
        print("\nERROR in invoke_pdf_ocr. Max retries reached. Aborting.")
        raise APILimitExceededError("Max retries reached. Aborting.")

    try:

        # Upload PDF file to Mistral's OCR service
        client = Mistral(api_key=os.getenv("MISTRAL_API_KEY"))
        pdf_file = pdf_filepath

        uploaded_file = client.files.upload(
            file={
                "file_name": pdf_file.stem,
                "content": pdf_file.read_bytes(),
            },
            purpose="ocr",
        )

        # Get URL for the uploaded file
        signed_url = client.files.get_signed_url(
            file_id=uploaded_file.id, expiry=1)

        # Process PDF with OCR, including embedded images
        pdf_response = client.ocr.process(
            document={"type": "document_url", "document_url": signed_url.url},
            model="mistral-ocr-latest",
            include_image_base64=True
        )

        return pdf_response

    except Exception as e:
        print(f"\nERROR in invoke_pdf_ocr: {e}")

        if "throttling" in str(e).lower():
            retries += 1
            delay = retries * 10
            print(
                f"Throttling encountered. Retrying in {delay}s (retry #{retries}).")
            time.sleep(delay)
            return invoke_pdf_ocr(pdf_filepath, retries)

        raise e
