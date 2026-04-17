# Terraform State (Encrypted)

This branch stores AES-256-CBC encrypted Terraform state files.
Decryption key is stored in GitHub Secrets as `TFSTATE_ENCRYPTION_KEY`.
Do not modify manually.
