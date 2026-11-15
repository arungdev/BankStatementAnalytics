using BankStatementAnalytics.Tenancy;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BankStatementAnalytics.Controllers.Api;

[ApiController,Authorize,Route("api/workspace/database-backup"),EnableRateLimiting("auth")]
public sealed class WorkspaceBackupApiController : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Backup(CancellationToken token) {
        if(!AppTenantRuntime.Enabled) return NotFound();
        var bytes=await AppTenantRuntime.Store.BackupAsync(User,token);
        return File(bytes,"application/octet-stream","workspace-database.snapshot");
    }
    [HttpPost("restore"),RequestSizeLimit(51_000_000)]
    public async Task<IActionResult> Restore(IFormFile file,CancellationToken token) {
        if(!AppTenantRuntime.Enabled) return NotFound();
        if(file.Length is <=0 or >50_000_000) return BadRequest(new {message="Select a workspace snapshot smaller than 50 MB."});
        using var memory=new MemoryStream(); await file.CopyToAsync(memory,token);
        try { await AppTenantRuntime.Store.RestoreAsync(User,memory.ToArray(),token); }
        catch(Exception error) when(error is System.Security.Cryptography.CryptographicException or System.Text.Json.JsonException or InvalidOperationException) {
            return BadRequest(new {message="Snapshot could not be restored. Verify that it belongs to this workspace and schema version."});
        }
        return Ok(new {message="Your workspace database was restored. Other workspaces were unchanged."});
    }
}
