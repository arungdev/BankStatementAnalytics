using Microsoft.AspNetCore.Mvc;
using Common.Framework.Web;
using BankStatementAnalytics.Services;
using System;
using System.Threading.Tasks;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/transfers")]
    public class TransfersApiController : TenantControllerBase
    {
        private readonly TransferDetectionService _service;

        public TransfersApiController(TransferDetectionService service)
        {
            _service = service;
        }

        // GET: api/transfers — confirmed transfer pairs (rows sharing a TransferGroupId).
        [HttpGet]
        public IActionResult GetMarked()
        {
            return Ok(_service.GetMarked(CurrentUserId));
        }

        // GET: api/transfers/suggestions — detected debit↔credit pairs not yet confirmed.
        [HttpGet("suggestions")]
        public IActionResult GetSuggestions()
        {
            return Ok(_service.DetectSuggestions(CurrentUserId));
        }

        // POST: api/transfers/mark — confirm one suggested pair.
        [HttpPost("mark")]
        public async Task<IActionResult> Mark([FromBody] MarkTransferRequest req)
        {
            if (req?.From == null || req.To == null)
                return BadRequest("Both transfer legs are required.");

            var groupId = await _service.MarkPairAsync(CurrentUserId, req.From, req.To);
            if (groupId == null)
                return BadRequest("The selected transactions don't form a valid transfer pair.");

            return Ok(new { groupId });
        }

        // DELETE: api/transfers/{groupId} — unlink a confirmed pair.
        [HttpDelete("{groupId}")]
        public async Task<IActionResult> Unmark(Guid groupId)
        {
            return await _service.UnmarkAsync(CurrentUserId, groupId) ? NoContent() : NotFound();
        }
    }

    public class MarkTransferRequest
    {
        public TransferLegKey? From { get; set; }
        public TransferLegKey? To { get; set; }
    }
}
