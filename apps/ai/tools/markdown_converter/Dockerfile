FROM public.ecr.aws/shelf/lambda-libreoffice-base:7.6-python3.12-x86_64

RUN dnf install -y \
    cairo pango gdk-pixbuf2 libffi-devel \
    cairo-devel pango-devel gdk-pixbuf2-devel \
    tar xz wget \
    && dnf clean all

# Install static ffmpeg binary (not available in base image repos)
RUN mkdir -p /tmp/ffmpeg-build && \
    cd /tmp/ffmpeg-build && \
    wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar -xvf ffmpeg-release-amd64-static.tar.xz && \
    cp ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ffmpeg && \
    cp ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ffprobe && \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg-build

WORKDIR ${LAMBDA_TASK_ROOT}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY clients/ ./clients/
COPY converters/ ./converters/
COPY worker.py main.py prompts.json ./

# The base image provides the Lambda Runtime Interface Client as its entrypoint;
# leaving it intact (no `ENTRYPOINT []`) + this CMD runs the SQS worker handler.
CMD ["worker.lambda_handler"]
