from io import BytesIO
from PIL import Image

from clients import bedrock_utils


def convert(source_data: bytes, source, config) -> str:
    """Convert image to markdown with detailed description via Bedrock (Claude) vision."""
    try:
        # Convert/validate image format using PIL
        try:
            img = Image.open(BytesIO(source_data))

            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')

            output_buffer = BytesIO()
            img.save(output_buffer, format='JPEG', quality=95)
            output_buffer.seek(0)
            processed_bytes = output_buffer.getvalue()

        except Exception as e:
            print(f"Warning: Could not process image with PIL: {e}")
            processed_bytes = source_data

        prompt = config.prompts["image_description"]
        instructions = f"{prompt['system']}\n\n{prompt['user']}"

        description = bedrock_utils.analyze_image(processed_bytes, instructions)

        markdown_content = f"# Image Description\n\n"
        markdown_content += f"## Description\n\n{description}\n"

        return markdown_content

    except Exception as e:
        print(f"Error converting image: {e}")
        raise
