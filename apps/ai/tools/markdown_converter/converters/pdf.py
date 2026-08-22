import os
import base64
import tempfile
from typing import Dict
from pathlib import Path
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

from clients import bedrock_utils, mistral_client


def convert(source_data: bytes, source, config) -> Dict[int, str]:
    """Convert PDF to markdown with page separation and image descriptions."""
    try:
        # Write bytes to temporary file for Mistral OCR
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_file:
            tmp_file.write(source_data)
            tmp_path = Path(tmp_file.name)

        try:
            # Use Mistral OCR for text extraction
            ocr_response = mistral_client.invoke_pdf_ocr(tmp_path)

            # Process pages concurrently (max 5 at a time for API rate limiting)
            pages_content = {}
            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_page = {
                    executor.submit(_process_page, page, page_num, config.prompts): page_num
                    for page_num, page in enumerate(ocr_response.pages, 1)
                }

                for future in as_completed(future_to_page):
                    page_num = future_to_page[future]
                    try:
                        pages_content[page_num] = future.result()
                    except Exception as e:
                        print(f"Error processing page {page_num}: {e}")
                        raise

            return pages_content

        finally:
            os.unlink(tmp_path)

    except Exception as e:
        print(f"Error converting PDF: {e}")
        raise


def _process_page(page, page_num: int, prompts: dict) -> str:
    """Process a single PDF page with image descriptions."""
    try:
        markdown_content = f"# Page {page_num}\n\n"
        page_text = page.markdown

        # Extract and describe images in parallel
        if page.images:
            # Decode all images first
            decoded_images = []
            for img in page.images:
                try:
                    image_data = img.image_base64
                    if image_data.startswith('data:'):
                        _, _, base64_content = image_data.partition(',')
                        img_bytes = base64.b64decode(base64_content)
                    else:
                        img_bytes = base64.b64decode(image_data)
                    decoded_images.append((img, img_bytes))
                except Exception as e:
                    print(f"Error decoding image {img.id}: {e}")
                    page_text = page_text.replace(
                        f"![{img.id}]({img.id})",
                        _format_image_block("Image description unavailable.")
                    )

            # Describe all images concurrently
            if decoded_images:
                with ThreadPoolExecutor(max_workers=min(len(decoded_images), 3)) as img_executor:
                    future_to_img = {
                        img_executor.submit(_describe_image, img_bytes, prompts): img
                        for img, img_bytes in decoded_images
                    }
                    for future in as_completed(future_to_img):
                        img = future_to_img[future]
                        try:
                            description = future.result()
                            img_placeholder = f"![{img.id}]({img.id})"
                            img_replacement = _format_image_block(description)
                            page_text = page_text.replace(img_placeholder, img_replacement)
                        except Exception as e:
                            print(f"Error describing image {img.id}: {e}")
                            page_text = page_text.replace(
                                f"![{img.id}]({img.id})",
                                _format_image_block("Image description unavailable.")
                            )

        markdown_content += page_text
        return markdown_content

    except Exception as e:
        print(f"Error processing PDF page {page_num}: {e}")
        raise


def _describe_image(image_bytes: bytes, prompts: dict) -> str:
    """Use Bedrock (Claude) vision to describe an image."""
    try:
        # Convert/validate image format using PIL
        try:
            img = Image.open(BytesIO(image_bytes))

            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')

            output_buffer = BytesIO()
            img.save(output_buffer, format='JPEG', quality=95)
            output_buffer.seek(0)
            processed_bytes = output_buffer.getvalue()

        except Exception as e:
            print(f"Warning: Could not process image with PIL: {e}")
            processed_bytes = image_bytes

        prompt = prompts["image_description"]
        instructions = f"{prompt['system']}\n\n{prompt['user']}"

        description = bedrock_utils.analyze_image(processed_bytes, instructions)
        return description

    except Exception as e:
        print(f"Error describing image: {e}")
        return "Image description unavailable due to processing error."


def _format_image_block(body: str) -> str:
    """Wrap an image description as a rule-delimited markdown block."""
    return f"\n\n---\n\n**Image description:**\n\n{body}\n\n---\n\n"
