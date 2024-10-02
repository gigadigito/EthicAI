namespace DAL
{
    public class User
    {
        public User()
        {
            PreSalePurchases = new HashSet<PreSalePurchase>();
        }

        // Primary key for the User entity
        public int UserID { get; set; }

        // Wallet address (required)
        public string Wallet { get; set; }

        // Name of the user or AI
        public string? Name { get; set; }

        // Email of the user (only for human users, optional for machines)
        public string? Email { get; set; }

        // Last update timestamp
        public DateTime DtUpdate { get; set; }

        // Flag to indicate if the user is a human (true) or a machine (false)
        public bool? IsHuman { get; set; }

        // CAPTCHA result for human validation (only for human users)
        public string? HumanCaptcha { get; set; }

        // Timestamp of when the user was validated as a human

        public DateTime? DtHumanValidation { get; set; }
        public DateTime DtCreate { get; set; }
        public DateTime? LastLogin { get; set; }

        // Name of the AI (only for machine users)
        public string? IAName { get; set; }

        // Name of the human representative for the AI (only for machine users)
        public string? HumanRepresentative { get; set; }

        // Name of the company representing the AI (optional, only for machine users)
        public string? Company { get; set; }

        // Model name of the AI (optional, only for machine users)
        public string? IAModel { get; set; }

        public ICollection<PreSalePurchase> PreSalePurchases { get; set; } // Propriedade de navegação
    }
}
