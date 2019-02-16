using Microsoft.AspNetCore.Mvc;
using Hexdigits.Azure.PointerAsAService.Models;
using Hexdigits.Azure.PointerAsAService.Services;

namespace Hexdigits.Azure.PointerAsAService.Controllers
{
    public class HomeController : Controller
    {
        private readonly QrCodeService _qrCodeService;
        private readonly IdService _idService;

        public HomeController(IdService idService, QrCodeService qrCodeService)
        {
            _idService = idService;
            _qrCodeService = qrCodeService;
        }

        [Route("~/{id?}")]
        public IActionResult Index(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return RedirectToAction("Index", new { id = _idService.Generate() });
            }

            var url = Url.Action("Control", "Home", new { id }, Request.Scheme);
            var viewModel = new HomeViewModel
            {
                Id = id,
                Url = url,
                // Base64Url = _qrCodeService.GenerateBase64(url)
            };

            return View(viewModel);
        }

        [Route("~/refresh")]
        public IActionResult Refresh()
        {
            var id = _idService.Generate();
            var url = Url.Action("Control", "Home", new { id }, Request.Scheme);
            var viewModel = new HomeViewModel
            {
                Id = id,
                Url = url,
                // Base64Url = _qrCodeService.GenerateBase64(url)
            };

            return Json(viewModel);
        }

        [Route("~/control/{id}")]
        public IActionResult Control(string id)
        {
            var viewModel = new ControlViewModel
            {
                Id = id
            };

            return View(viewModel);
        }
    }
}
