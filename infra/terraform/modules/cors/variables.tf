variable "rest_api_id" {
  description = "Id of the REST API the resource belongs to."
  type        = string
}

variable "resource_id" {
  description = "Id of the API Gateway resource to attach the preflight to."
  type        = string
}

variable "allow_methods" {
  description = "Value of Access-Control-Allow-Methods, e.g. \"DELETE,OPTIONS\"."
  type        = string
}

variable "allow_headers" {
  description = "Value of Access-Control-Allow-Headers."
  type        = string
  default     = "Content-Type,Authorization"
}

variable "allow_origin" {
  description = "Value of Access-Control-Allow-Origin."
  type        = string
  default     = "*"
}
