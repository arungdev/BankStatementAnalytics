using BankStatementAnalytics.Models;
using NHibernate.Mapping.ByCode;
using NHibernate.Mapping.ByCode.Conformist;
namespace BankStatementAnalytics.Mappping;
public class ExternalLoginMap : ClassMapping<ExternalLogin>
{
    public ExternalLoginMap()
    {
        Table("external_logins");
        Id(x => x.Id, m => { m.Generator(Generators.Assigned); m.Length(64); });
        Property(x => x.UserId, m => m.NotNullable(true));
        Property(x => x.Provider, m => { m.Length(30); m.NotNullable(true); });
        Property(x => x.Subject, m => { m.Length(200); m.NotNullable(true); });
        Property(x => x.Email, m => m.Length(320));
        Property(x => x.DisplayName, m => m.Length(200));
    }
}
