# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS client
WORKDIR /src/Client
COPY Client/package*.json ./
COPY Client/vendor/ vendor/
RUN npm ci
COPY Client/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY BankStatementAnalytics/BankStatementAnalytics.csproj BankStatementAnalytics/
COPY BankStatementAnalytics/lib/ BankStatementAnalytics/lib/
RUN dotnet restore BankStatementAnalytics/BankStatementAnalytics.csproj
COPY BankStatementAnalytics/ BankStatementAnalytics/
COPY deploy/common/Source/ deploy/common/Source/
COPY --from=client /src/BankStatementAnalytics/wwwroot/ BankStatementAnalytics/wwwroot/
RUN dotnet publish BankStatementAnalytics/BankStatementAnalytics.csproj -c Release --no-restore \
    -p:SkipClientBuild=true -p:UseSharedCompilation=false -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble AS runtime
WORKDIR /app
# Ubuntu 24.04 provides PostgreSQL 16 clients, matching the database service.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl fonts-dejavu-core postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish/ ./
RUN mkdir -p Data Uploads Logs Sessions && chown -R app:app Data Uploads Logs Sessions
ENV Urls=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    Database__Provider=Postgres \
    Database__Embedded=false \
    Updates__AutoCheckOnStartup=false \
    DOTNET_gcServer=0
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8080/health || exit 1
# AppPaths uses the executable path, so launch the apphost directly.
ENTRYPOINT ["./BankStatementAnalytics"]
