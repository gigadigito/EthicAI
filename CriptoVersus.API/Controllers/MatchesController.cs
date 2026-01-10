using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers
{
    public class MatchesController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
