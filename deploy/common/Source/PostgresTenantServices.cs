using Microsoft.Extensions.DependencyInjection;
using NHibernate.Cfg;

namespace Common.Framework.Tenancy.Postgres;

public static class PostgresTenantServices
{
    /// <summary>Data Protection must already be configured with persistent, shared keys.</summary>
    public static IServiceCollection AddPostgresSchemaTenancy(this IServiceCollection services,PostgresTenantOptions options,ITenantSchemaDefinition definition,Func<IServiceProvider,Configuration> mappings)
    {
        services.AddSingleton(options);
        services.AddSingleton(definition);
        services.AddSingleton<PostgresTenantStore>();
        services.AddSingleton<IPostgresTenantStore>(provider=>provider.GetRequiredService<PostgresTenantStore>());
        services.AddSingleton<TenantExecutionContext>();
        services.AddSingleton(provider=>new PostgresTenantSessions(mappings(provider),provider.GetRequiredService<IPostgresTenantStore>(),provider.GetRequiredService<TenantExecutionContext>()));
        return services;
    }
}
