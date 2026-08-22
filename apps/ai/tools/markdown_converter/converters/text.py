import csv
import io
import json
from typing import Union, Dict


def convert_text(source_data: bytes, source, config) -> str:
    """Convert plain text (TXT, RTF) to markdown."""
    try:
        text = source_data.decode('utf-8', errors='ignore')

        markdown_content = f"# Text Document\n\n"
        markdown_content += text

        return markdown_content

    except Exception as e:
        print(f"Error converting text file: {e}")
        raise


def convert_csv(source_data: bytes, source, config, rows_per_page: int = 100) -> Union[str, Dict[int, str]]:
    """Convert CSV/TSV files to markdown tables with pagination for large files."""
    try:
        text = source_data.decode('utf-8', errors='ignore')

        # Detect delimiter (comma or tab)
        delimiter = '\t' if '\t' in text.split('\n')[0] else ','

        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        rows = list(reader)

        if not rows:
            return "# Empty CSV File\n\nNo data found in the file."

        header = rows[0] if rows else []
        data_rows = rows[1:] if len(rows) > 1 else []
        total_data_rows = len(data_rows)

        # Format header for markdown table
        header_line = "| " + " | ".join(str(cell) for cell in header) + " |\n"
        separator_line = "|" + "---|" * len(header) + "\n"

        if total_data_rows <= rows_per_page:
            # Small file - return as single string
            markdown_content = "# Data Table\n\n"
            markdown_content += f"*Total rows: {total_data_rows + 1} (including header)*\n\n"
            markdown_content += header_line
            markdown_content += separator_line

            for row in data_rows:
                while len(row) < len(header):
                    row.append("")
                row = row[:len(header)]
                escaped_row = [str(cell).replace('|', '\\|') for cell in row]
                markdown_content += "| " + " | ".join(escaped_row) + " |\n"

            return markdown_content

        else:
            # Large file - return as paginated dictionary
            pages_content = {}
            total_pages = (total_data_rows + rows_per_page - 1) // rows_per_page

            for page_num in range(1, total_pages + 1):
                start_idx = (page_num - 1) * rows_per_page
                end_idx = min(start_idx + rows_per_page, total_data_rows)
                page_data = data_rows[start_idx:end_idx]

                page_content = f"# Data Table - Page {page_num}\n\n"
                page_content += f"*Page {page_num} of {total_pages}*\n"
                page_content += f"*Rows {start_idx + 1}-{end_idx} of {total_data_rows} (excluding header)*\n"
                page_content += f"*Total rows in file: {total_data_rows + 1} (including header)*\n\n"

                page_content += header_line
                page_content += separator_line

                for row in page_data:
                    while len(row) < len(header):
                        row.append("")
                    row = row[:len(header)]
                    escaped_row = [str(cell).replace('|', '\\|') for cell in row]
                    page_content += "| " + " | ".join(escaped_row) + " |\n"

                pages_content[page_num] = page_content

            return pages_content

    except Exception as e:
        print(f"Error converting CSV/TSV file: {e}")
        raise


def convert_json(source_data: bytes, source, config) -> str:
    """Convert JSON to formatted markdown."""
    try:
        text = source_data.decode('utf-8', errors='ignore')
        data = json.loads(text)

        markdown_content = "# JSON Document\n\n"

        markdown_content += "```json\n"
        markdown_content += json.dumps(data, indent=2, ensure_ascii=False)
        markdown_content += "\n```\n\n"

        markdown_content += "## Structure Summary\n\n"
        markdown_content += _summarize_json_structure(data)

        return markdown_content

    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return f"# Invalid JSON Document\n\n```\n{text}\n```\n\nError: {str(e)}"
    except Exception as e:
        print(f"Error converting JSON file: {e}")
        raise


def _summarize_json_structure(data, level=0, max_level=3):
    """Helper function to create a summary of JSON structure."""
    if level > max_level:
        return ""

    summary = ""
    indent = "  " * level

    if isinstance(data, dict):
        for key in list(data.keys())[:10]:
            value = data[key]
            if isinstance(value, (dict, list)):
                summary += f"{indent}- **{key}**: {type(value).__name__}\n"
                summary += _summarize_json_structure(value, level + 1, max_level)
            else:
                summary += f"{indent}- **{key}**: {type(value).__name__}\n"
        if len(data) > 10:
            summary += f"{indent}- ... and {len(data) - 10} more keys\n"
    elif isinstance(data, list) and data:
        summary += f"{indent}- List with {len(data)} items\n"
        if len(data) > 0:
            summary += _summarize_json_structure(data[0], level + 1, max_level)

    return summary


def convert_xml(source_data: bytes, source, config, chars_per_page: int = 25000) -> Union[str, Dict[int, str]]:
    """Convert XML to formatted markdown with pagination for large files."""
    try:
        import xml.etree.ElementTree as ET
        import xml.dom.minidom as minidom

        text = source_data.decode('utf-8', errors='ignore')

        # Try to pretty print the XML
        try:
            dom = minidom.parseString(text)
            pretty_xml = dom.toprettyxml(indent="  ")
            pretty_xml = '\n'.join([line for line in pretty_xml.split('\n') if line.strip()])
        except Exception:
            pretty_xml = text

        # Parse and create structure summary
        structure_summary = ""
        try:
            root = ET.fromstring(text)
            structure_summary += "## Structure Summary\n\n"
            structure_summary += f"- **Root element**: {root.tag}\n"
            if root.attrib:
                structure_summary += f"- **Root attributes**: {dict(root.attrib)}\n"

            child_tags = {}
            for child in root:
                child_tags[child.tag] = child_tags.get(child.tag, 0) + 1

            if child_tags:
                structure_summary += "- **Child elements**:\n"
                for tag, count in child_tags.items():
                    structure_summary += f"  - {tag}: {count} occurrences\n"

            structure_summary += f"\n*Total XML size: {len(pretty_xml):,} characters*\n"
        except Exception:
            structure_summary = "## Structure Summary\n\n*Unable to parse XML structure*\n"

        if len(pretty_xml) <= chars_per_page:
            markdown_content = "# XML Document\n\n"
            markdown_content += structure_summary + "\n"
            markdown_content += "```xml\n"
            markdown_content += pretty_xml
            markdown_content += "\n```\n"

            return markdown_content

        else:
            pages_content = {}
            total_pages = (len(pretty_xml) + chars_per_page - 1) // chars_per_page

            for page_num in range(1, total_pages + 1):
                start_idx = (page_num - 1) * chars_per_page
                end_idx = min(start_idx + chars_per_page, len(pretty_xml))
                page_xml = pretty_xml[start_idx:end_idx]

                if page_num == 1:
                    page_content = f"# XML Document - Page {page_num}\n\n"
                    page_content += f"*Page {page_num} of {total_pages}*\n\n"
                    page_content += structure_summary + "\n"
                    page_content += "## Content\n\n"
                    page_content += "```xml\n"
                    page_content += page_xml
                    if page_num < total_pages:
                        page_content += "\n... (continued on next page)"
                    page_content += "\n```\n"
                else:
                    page_content = f"# XML Document - Page {page_num}\n\n"
                    page_content += f"*Page {page_num} of {total_pages}*\n"
                    page_content += f"*Characters {start_idx + 1:,}-{end_idx:,} of {len(pretty_xml):,}*\n\n"
                    page_content += "```xml\n"
                    page_content += "... (continued from previous page)\n"
                    page_content += page_xml
                    if page_num < total_pages:
                        page_content += "\n... (continued on next page)"
                    page_content += "\n```\n"

                pages_content[page_num] = page_content

            return pages_content

    except Exception as e:
        print(f"Error converting XML file: {e}")
        raise


def convert_markdown(source_data: bytes, source, config) -> str:
    """Validate and clean existing markdown files."""
    try:
        text = source_data.decode('utf-8', errors='ignore')

        # Remove excessive blank lines (more than 2 consecutive)
        lines = text.split('\n')
        cleaned_lines = []
        blank_count = 0

        for line in lines:
            if not line.strip():
                blank_count += 1
                if blank_count <= 2:
                    cleaned_lines.append(line)
            else:
                blank_count = 0
                cleaned_lines.append(line)

        cleaned_text = '\n'.join(cleaned_lines)

        # Ensure document has a title
        if not cleaned_text.strip().startswith('#'):
            cleaned_text = "# Document\n\n" + cleaned_text

        return cleaned_text

    except Exception as e:
        print(f"Error processing markdown file: {e}")
        raise
