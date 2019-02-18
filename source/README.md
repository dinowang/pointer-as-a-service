# Build Instruction

## Install Libman

```bash
dotnet tool install -g Microsoft.Web.LibraryManager.Cli
```

## Restore packages

```bash
libman restore
```

## Run the project

```bash
dotnet run --launch-profile Production
```