# Pointer as a Service

## Purpose

Provide the easiest way of making a smartphone can control your presentation. Working on all devices, working without apps installing, working without pairing, it only needs internet.

## How it works

![Flow](./images/flow.jpg)

### Themes

![Host Themes](./images/host-themes.png)

## Install Office Add-ins

### PowerPoint for Windows

https://docs.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins

### PowerPoint for macOS

https://docs.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-ipad-and-mac 

```bash
# 請將 <OWNER> 替換為你的 GitHub 帳號或組織名稱
curl https://raw.githubusercontent.com/<OWNER>/pointer-as-a-service/main/manifest/pointer-as-a-service.xml -o ~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/pointer-as-a-service.xml
```

### PowerPoint Online

First, download Office Add-ins manifest from [manifest/pointer-as-a-service.xml](manifest/pointer-as-a-service.xml) and save to your local disk.

![Install Addins for PowerPoint Online](./images/powerpoint-online-install-addins.png)


## Used technology

- Azure
- ASP.NET Core
- ASP.NET Core SignalR
- Office 365 PowerPoint

[Build Instruction](src/aspnetcore/README.md)

## License

The project is licensed under the MIT license.