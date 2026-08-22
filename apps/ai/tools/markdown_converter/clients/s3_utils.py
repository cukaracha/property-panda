import boto3
from botocore.config import Config
import json
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed


def decode_s3_key(object_key):
    """
    Given an S3 object key, decode any URL-encoded characters.
    """
    return urllib.parse.unquote_plus(object_key)


def get_event_bucket_key_uri(event_record):
    '''
    Extracts the bucket, key, and S3 URI and returns a tuple in that order.
    '''

    try:
        body = json.loads(event_record['body'])
        record = body['Records'][0]
        bucket = record['s3']['bucket']['name']
        raw_key = record['s3']['object']['key']
        key = decode_s3_key(raw_key)
        s3_uri = f"s3://{bucket}/{key}"

        return (bucket, key, s3_uri)

    except Exception as e:
        print(f"ERROR in get_event_bucket_key_uri: {e}")
        raise e


def upload_file(source_filepath: str, bucket: str, object_key: str):

    try:
        # Create an S3 client
        s3 = boto3.client('s3')
        s3.upload_file(source_filepath, bucket, object_key)

    except Exception as e:
        print(f"ERROR in upload_file {e}")
        raise e


def mult_upload_file(source_filepaths: list, bucket: str, object_keys: list):

    with ThreadPoolExecutor(max_workers=10) as pool:
        for i in range(len(source_filepaths)):
            source_filepath = source_filepaths[i]
            object_key = object_keys[i]
            pool.submit(upload_file, source_filepath, bucket, object_key)


def delete_s3_file(bucket_name: str, file_key: str):
    """
    Deletes a file from an S3 bucket.

    :param bucket_name: Name of the S3 bucket.
    :param file_key: Key (path) of the file to delete.
    """
    s3_client = boto3.client("s3")
    try:
        s3_client.delete_object(Bucket=bucket_name, Key=file_key)
        print(
            f"File '{file_key}' deleted successfully from bucket '{bucket_name}'.")
    except Exception as e:
        print(f"Error deleting file '{file_key}': {e}")
        raise e


def copy_s3_file(source_bucket: str, source_key: str, target_bucket: str, target_key: str):

    try:
        s3 = boto3.client('s3')

        # Copy the file to the new location
        s3.copy_object(
            Bucket=target_bucket,
            CopySource={'Bucket': source_bucket, 'Key': source_key},
            Key=target_key
        )

        print(
            f"Successfully copied file from {source_bucket}/{source_key} to {target_bucket}/{target_key}")

    except Exception as e:
        print(f"ERROR in copy_s3_file: {e}")
        raise e


def move_s3_file(source_bucket: str, source_key: str, target_bucket: str, target_key: str):

    try:
        copy_s3_file(source_bucket, source_key, target_bucket, target_key)
        delete_s3_file(source_bucket, source_key)

    except Exception as e:
        print(f"ERROR in move_s3_file: {e}")
        raise e


def list_s3_files(bucket_name: str, prefix: str = '', suffix: str = None):
    """
    Lists all files in an S3 bucket.

    :param bucket_name: Name of the S3 bucket
    :param prefix: Optional prefix to filter files (e.g., folder path)
    :param suffix: Optional suffix to filter files (e.g., '.md')
    :return: List of file keys
    """

    try:
        s3_client = boto3.client('s3')
        file_list = []

        paginator = s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            if 'Contents' in page:
                for obj in page['Contents']:
                    key = obj['Key']
                    if suffix is None or key.endswith(suffix):
                        file_list.append(key)

        return file_list

    except Exception as e:
        print(f"ERROR in list_s3_files: {e}")
        raise e


def is_file_exists(bucket: str, object_key: str) -> bool:
    '''
    Checks if a file already exists in S3 based on the bucket and object key.
    Returns a bool.
    '''

    s3 = boto3.client('s3')

    try:
        s3.head_object(Bucket=bucket, Key=object_key)
        return True

    except:
        return False


def get_s3_object_bytes(bucket: str, key: str) -> bytes:
    """
    Get S3 object content as bytes (memory-only operation).

    :param bucket: S3 bucket name
    :param key: S3 object key
    :return: Content as bytes
    """
    try:
        s3_client = boto3.client('s3')
        response = s3_client.get_object(Bucket=bucket, Key=key)
        return response['Body'].read()
    except Exception as e:
        print(f"ERROR in get_s3_object_bytes for {bucket}/{key}: {e}")
        raise e


def put_json_object(bucket: str, key: str, data: any) -> None:
    """
    Upload a JSON object to S3.

    :param bucket: S3 bucket name
    :param key: S3 object key
    :param data: Data to serialize as JSON and upload
    """
    try:
        s3_client = boto3.client('s3')
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(data),
            ContentType='application/json'
        )
        print(f"Successfully uploaded JSON to {bucket}/{key}")
    except Exception as e:
        print(f"ERROR in put_json_object for {bucket}/{key}: {e}")
        raise e


def put_object(bucket: str, key: str, body, content_type: str = 'application/octet-stream') -> None:
    """
    Upload an object to S3.

    :param bucket: S3 bucket name
    :param key: S3 object key
    :param body: Content to upload (str, bytes, or file-like object). Strings are automatically UTF-8 encoded.
    :param content_type: MIME type (default: 'application/octet-stream')
    """
    try:
        s3_client = boto3.client('s3')
        if isinstance(body, str):
            body = body.encode('utf-8')
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType=content_type
        )
        print(f"Successfully uploaded object to {bucket}/{key}")
    except Exception as e:
        print(f"ERROR in put_object for {bucket}/{key}: {e}")
        raise e


def get_s3_prefix(s3_key: str) -> str:
    """
    Extract the prefix (directory path) from an S3 key.

    :param s3_key: Full S3 object key (e.g., 'folder/subfolder/file.txt')
    :return: Prefix without the filename (e.g., 'folder/subfolder/')
    """
    if '/' in s3_key:
        return s3_key.rpartition('/')[0] + '/'
    return ''


def parse_s3_uri(s3_uri: str) -> tuple:
    """
    Parse an S3 URI into bucket and key components.

    :param s3_uri: S3 URI (e.g., 's3://bucket-name/path/to/file.txt')
    :return: Tuple of (bucket_name, object_key)
    :raises ValueError: If URI format is invalid
    """
    if not s3_uri.startswith('s3://'):
        raise ValueError(f"Invalid S3 URI format: {s3_uri}")

    # Remove 's3://' prefix and split into bucket and key
    path = s3_uri[5:]  # Remove 's3://'
    if '/' not in path:
        raise ValueError(f"Invalid S3 URI format (missing key): {s3_uri}")

    bucket, key = path.split('/', 1)
    if not bucket or not key:
        raise ValueError(f"Invalid S3 URI format (empty bucket or key): {s3_uri}")

    return (bucket, key)


def mult_delete_s3_files(bucket_name: str, file_keys: list, max_workers: int = 10) -> dict:
    """
    Delete multiple S3 files concurrently.

    :param bucket_name: S3 bucket name
    :param file_keys: List of object keys to delete
    :param max_workers: Maximum concurrent workers (default 10)
    :return: Stats dict with 'total', 'successful', 'failed', 'errors'
    """
    results = {
        'total': len(file_keys),
        'successful': 0,
        'failed': 0,
        'errors': []
    }

    if not file_keys:
        return results

    def delete_single_file(file_key: str) -> dict:
        try:
            delete_s3_file(bucket_name, file_key)
            return {'success': True, 'key': file_key}
        except Exception as e:
            return {'success': False, 'key': file_key, 'error': str(e)}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(delete_single_file, key): key
            for key in file_keys
        }

        for future in as_completed(futures):
            result = future.result()
            if result['success']:
                results['successful'] += 1
            else:
                results['failed'] += 1
                results['errors'].append(result)

    print(f"S3 deletion results: {results['successful']}/{results['total']} successful")
    return results


def _generate_presigned_url_helper(
    operation: str,
    bucket_name: str,
    object_key: str,
    expires_in: int,
    extra_params: dict = None
) -> dict:
    """
    Internal helper to generate presigned URLs for any S3 operation.

    :param operation: S3 operation ('put_object', 'get_object', etc.)
    :param bucket_name: S3 bucket name
    :param object_key: S3 object key (path)
    :param expires_in: URL expiration time in seconds
    :param extra_params: Additional params like ContentType (default: None)
    :return: Dict with 'presignedUrl', 'key', 's3Uri', 'expiresIn'
    """
    try:
        config = Config(s3={'use_accelerate_endpoint': True})
        s3_client = boto3.client('s3', config=config)

        params = {
            'Bucket': bucket_name,
            'Key': object_key,
        }

        if extra_params:
            params.update(extra_params)

        presigned_url = s3_client.generate_presigned_url(
            operation,
            Params=params,
            ExpiresIn=expires_in
        )

        s3_uri = f"s3://{bucket_name}/{object_key}"

        return {
            'presignedUrl': presigned_url,
            'key': object_key,
            's3Uri': s3_uri,
            'expiresIn': expires_in
        }

    except Exception as e:
        print(f"ERROR generating presigned URL for {bucket_name}/{object_key}: {e}")
        raise e


def generate_presigned_upload_url(
    bucket_name: str,
    object_key: str,
    content_type: str = 'application/octet-stream',
    expires_in: int = 3600
) -> dict:
    """
    Generate a presigned URL for uploading a file to S3.

    This creates a temporary URL that allows PUT operations to upload files
    directly to S3 without AWS credentials. The URL expires after the specified time.

    :param bucket_name: S3 bucket name
    :param object_key: S3 object key (path) where the file will be stored
    :param content_type: MIME type of the file (default: 'application/octet-stream')
    :param expires_in: URL expiration time in seconds (default: 3600 = 1 hour)
    :return: Dict with 'presignedUrl', 'key', 's3Uri', 'expiresIn'
    :raises Exception: If presigned URL generation fails

    Example:
        >>> result = generate_presigned_upload_url(
        ...     'my-bucket',
        ...     'uploads/file.pdf',
        ...     'application/pdf',
        ...     3600
        ... )
        >>> # Upload file using the presigned URL
        >>> requests.put(result['presignedUrl'], data=file_content, headers={'Content-Type': 'application/pdf'})
    """
    return _generate_presigned_url_helper(
        operation='put_object',
        bucket_name=bucket_name,
        object_key=object_key,
        expires_in=expires_in,
        extra_params={'ContentType': content_type}
    )


def generate_presigned_download_url(
    bucket_name: str,
    object_key: str,
    expires_in: int = 900
) -> dict:
    """
    Generate a presigned URL for downloading a file from S3.

    This creates a temporary URL that allows GET operations to download files
    directly from S3 without AWS credentials. The URL expires after the specified time.

    :param bucket_name: S3 bucket name
    :param object_key: S3 object key (path) of the file to download
    :param expires_in: URL expiration time in seconds (default: 900 = 15 minutes)
    :return: Dict with 'presignedUrl', 'key', 's3Uri', 'expiresIn'
    :raises Exception: If presigned URL generation fails

    Example:
        >>> result = generate_presigned_download_url(
        ...     'my-bucket',
        ...     'LearningPaths/abc-123/assets/video.mp4',
        ...     900
        ... )
        >>> # Download file using the presigned URL
        >>> response = requests.get(result['presignedUrl'])
        >>> with open('video.mp4', 'wb') as f:
        ...     f.write(response.content)
    """
    return _generate_presigned_url_helper(
        operation='get_object',
        bucket_name=bucket_name,
        object_key=object_key,
        expires_in=expires_in
    )
