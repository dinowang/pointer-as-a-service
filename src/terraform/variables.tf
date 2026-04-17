variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}

variable "prefix" {
  description = "Naming prefix for all resources"
  type        = string
  default     = "pointer"
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "eastasia"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default = {
    project = "pointer-as-a-service"
  }
}
