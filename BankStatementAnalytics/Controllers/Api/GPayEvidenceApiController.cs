using BankStatementAnalytics.Services;
using Common.Framework.Web;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api;

[ApiController]
[Route("api/split-groups/evidence")]
public class GPayEvidenceApiController : TenantControllerBase
{
    private readonly GPayEvidenceService _service;
    public GPayEvidenceApiController(GPayEvidenceService service) => _service=service;
    [HttpGet] public async Task<IActionResult> Get() => Ok(await _service.Workspace(CurrentUserId));
    [HttpPost("auto-match")] public async Task<IActionResult> AutoMatch() => Ok(await _service.AutoMatchActivities(CurrentUserId));
    [HttpPost("preview-path")]
    public async Task<IActionResult> PreviewPath(ImportTakeoutPathRequest request) {
        try {
            if(string.IsNullOrWhiteSpace(request.FilePath)||!System.IO.File.Exists(request.FilePath))return BadRequest(new {message="File not found."});
            var size=new FileInfo(request.FilePath).Length;if(size>250_000_000)return BadRequest(new {message="File exceeds 250 MB."});
            var bundle=GPayEvidenceService.Scan(await System.IO.File.ReadAllBytesAsync(request.FilePath),request.FilePath);
            return Ok(await _service.Preview(CurrentUserId,bundle));
        } catch(Exception ex) when(ex is ArgumentException or FormatException or System.IO.InvalidDataException) {return BadRequest(new {message=ex.Message});}
    }
    [HttpPost("preview-upload")][RequestSizeLimit(250_000_000)]
    public async Task<IActionResult> PreviewUpload(IFormFile file) {
        try {
            using var memory=new MemoryStream();await file.CopyToAsync(memory);
            return Ok(await _service.Preview(CurrentUserId,GPayEvidenceService.Scan(memory.ToArray(),file.FileName)));
        } catch(Exception ex) when(ex is ArgumentException or FormatException or System.IO.InvalidDataException){return BadRequest(new {message=ex.Message});}
    }
    [HttpGet("candidates")]
    public async Task<IActionResult> Candidates(int? memberId,int? recordId,int days=7) {
        try {return Ok(await _service.Candidates(CurrentUserId,memberId,recordId,days));}catch(ArgumentException ex){return BadRequest(new {message=ex.Message});}
    }
    [HttpPost("repair")]
    public async Task<IActionResult> Repair(RepairRequest request) {
        try {await _service.ApplyRepair(CurrentUserId,request.RecordId,request.ExpectedFingerprint);return Ok(new {message="Source repair applied; bank links preserved."});}catch(ArgumentException ex){return BadRequest(new {message=ex.Message});}
    }
    [HttpPost("owner-alias")]
    public async Task<IActionResult> Alias(AliasRequest request) {
        try {await _service.AddOwnerAlias(CurrentUserId,request.Name);return Ok();}catch(ArgumentException ex){return BadRequest(new {message=ex.Message});}
    }
    [HttpPost("repair/{id:int}/undo")]
    public async Task<IActionResult> Undo(int id) {
        try {await _service.UndoRepair(CurrentUserId,id);return Ok();}catch(ArgumentException ex){return BadRequest(new {message=ex.Message});}
    }
    [HttpPost("review")]
    public async Task<IActionResult> Review(ReviewSourceRequest request) {
        try {await _service.ReviewSourceMatch(CurrentUserId,request);return Ok();}catch(ArgumentException ex){return BadRequest(new {message=ex.Message});}
    }
    [HttpPost("allocations")]
    public async Task<IActionResult> Allocate(AllocateRepaymentRequest request) {
        try {await _service.Allocate(CurrentUserId,request);return Ok();}catch(ArgumentException ex){return BadRequest(new {message=ex.Message});}
    }
    [HttpDelete("allocations/{id:int}")]
    public async Task<IActionResult> Remove(int id) {
        try {await _service.RemoveAllocation(CurrentUserId,id);return Ok();}catch(ArgumentException ex){return BadRequest(new {message=ex.Message});}
    }
}
public class RepairRequest { public int RecordId{get;set;} public string ExpectedFingerprint{get;set;}=""; }
public class AliasRequest {public string Name{get;set;}="";}
