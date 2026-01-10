using Microsoft.AspNetCore.Mvc;

namespace CriptoVersus.API.Controllers
{
    public class DashboardController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
