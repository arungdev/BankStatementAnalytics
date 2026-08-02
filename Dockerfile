# Build stage: compiles the React client and the .NET backend.
# Node is required here because BankStatementAnalytics.csproj runs
# `npm install && npm run build` in Client/ as part of any Release build
# (see the BuildReactClient MSBuild target), outputting straight into wwwroot.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Common.Framework is deliberately NOT copied: it is a private repo that is not part of
# a plain clone, and the backend no longer needs its source - it compiles against the
# vendored BankStatementAnalytics/lib/Common.Framework.dll instead (see README). Copying
# it would both break the build for anyone cloning and, when present, trip the csproj's
# CopyPgsqlBundle target, which shells out to robocopy (Windows-only) and fails on Linux.
COPY BankStatementAnalytics/ BankStatementAnalytics/
COPY Client/ Client/

WORKDIR /src/BankStatementAnalytics
# Node reuse can corrupt the FrameworkReference resolution when the graph mixes
# net10.0 (this project) and net8.0 (Common.Framework) in a single MSBuild session,
# intermittently dropping ASP.NET Core APIs (e.g. AddRateLimiter) from compilation.
ENV MSBUILDDISABLENODEREUSE=1
RUN dotnet publish BankStatementAnalytics.csproj -c Release -o /app/publish -p:UseSharedCompilation=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
RUN chmod +x ./BankStatementAnalytics

# Urls (NOT ASPNETCORE_URLS): appsettings.json ships "Urls": "http://localhost:5080" for the
# Windows desktop/service install. WebApplicationBuilder layers appsettings.json AFTER the
# ASPNETCORE_-prefixed host configuration, so that value wins over ASPNETCORE_URLS and the
# container would bind loopback:5080 - unreachable through the published port. The unprefixed
# environment-variable provider is layered after appsettings.json, so overriding the same "Urls"
# key here is what actually takes effect. Bind 0.0.0.0, not localhost, or Docker can't route in.
#
# Database__Embedded=false: appsettings.json defaults to the embedded PostgreSQL bundle,
# which ships Windows binaries (postgres.exe) and cannot run here. Force the external-server
# path; supply Database__PostgresConnectionString at run time (docker-compose.yml wires one up).
ENV Urls=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    Database__Embedded=false

EXPOSE 8080

# Data Protection keys (auth cookies) and Uploads must survive container recreation -
# mount these as volumes. The database itself lives in the separate postgres service.
VOLUME ["/app/Data", "/app/Uploads"]

# Run the apphost binary directly (not `dotnet BankStatementAnalytics.dll`) so that
# AppPaths.ResolveAppDirectory() (which reads Process.MainModule.FileName) resolves
# to /app instead of the dotnet muxer path.
ENTRYPOINT ["./BankStatementAnalytics"]
