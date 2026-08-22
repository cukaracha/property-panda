provider "aws" {
  region = local.region
  # Credentials come from the environment:
  # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN (or AWS_PROFILE).

  # Owner is the app name, set once here and applied to every taggable resource.
  default_tags {
    tags = {
      Owner = local.app_name
    }
  }
}
