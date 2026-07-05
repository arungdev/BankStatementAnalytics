# Build stage: compiles the React client and the .NET backend.
# Node is required here because BankStatementAnalytics.csproj runs
# `npm install && npm run build` in Client/ as part of any Release build
# (see the BuildReactClient MSBuild target), outputting straight into wwwroot.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY Common.Framework/ Common.Framework/
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

ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production

EXPOSE 8080

# Data (SQLite DB + Data Protection keys) and Uploads must survive container
# recreation - mount these as volumes.
VOLUME ["/app/Data", "/app/Uploads"]

# Run the apphost binary directly (not `dotnet BankStatementAnalytics.dll`) so that
# AppPaths.ResolveAppDirectory() (which reads Process.MainModule.FileName) resolves
# to /app instead of the dotnet muxer path.
ENTRYPOINT ["./BankStatementAnalytics"]
