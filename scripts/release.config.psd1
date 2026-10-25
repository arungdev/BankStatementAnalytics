@{
    ProjectFile = 'BankStatementAnalytics/BankStatementAnalytics.csproj'
    InstallerScript = 'BankStatementAnalytics/Installer/BankStatementAnalytics.iss'
    PortableScript = 'BankStatementAnalytics/Installer/build-portable.ps1'
    PgBundleDir = 'Common.Framework/Installer/PgBundle'
    BaseName = 'BankStatementAnalytics'
    ProductName = 'Bank Statement Analytics'
    DockerRepository = 'arungs125/bankstatementanalytics'
    Runtime = 'win-x64'
    ClientDirectory = 'Client'
    CheckProjects = @('Tests/GPayMatching', 'Tests/SharedBills', 'Tests/ImportReliability', 'Tests/SecurityAudit')
    CloudDocuments = @('docs/security/CLOUD_SECURITY.md', 'docs/security/SECURITY_AUDIT.md', 'deploy/GOOGLE-LOGIN-SETUP.md', 'docs/releases/RELEASE_NOTES_v{version}.md')
}
