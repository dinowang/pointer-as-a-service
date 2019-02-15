FROM microsoft/dotnet:2.2-aspnetcore-runtime AS base
RUN apt-get update -y && apt-get install -y libgdiplus && apt-get clean && ln -s /usr/lib/libgdiplus.so /usr/lib/gdiplus.dll
WORKDIR /app
EXPOSE 80

FROM microsoft/dotnet:2.2-sdk AS build
WORKDIR /src
COPY ["PointerAsAService.csproj", "./"]
RUN dotnet restore "./PointerAsAService.csproj"
COPY . .
WORKDIR "/src/."
RUN dotnet build "PointerAsAService.csproj" -c Release -o /app

FROM build AS publish
RUN dotnet publish "PointerAsAService.csproj" -c Release -o /app

FROM base AS final
WORKDIR /app
COPY --from=publish /app .
ENTRYPOINT ["dotnet", "PointerAsAService.dll"]
