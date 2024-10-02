using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL
{
    public class PreSalePurchase
    {
        [Key]
        public int Id { get; set; }

        [Required]
        public int UserId { get; set; } // Altere para int

        [Required]
        [Range(0.000000001, double.MaxValue, ErrorMessage = "A quantidade de SOL deve ser maior que zero.")]
        public decimal SolAmount { get; set; } // Quantidade de SOL enviada

        [Required]
        [Range(0.000000001, double.MaxValue, ErrorMessage = "A quantidade de EthicAI deve ser maior que zero.")]
        public decimal EthicAIAmt { get; set; } // Quantidade de EthicAI recebida

        [Required]
        public DateTime PurchaseDate { get; set; } // Data e hora da compra

        [MaxLength(100)]
        public string TransactionHash { get; set; } // Hash da transação na blockchain Solana


        // Propriedade de navegação para a entidade 'User'
        public User User { get; set; }
    }
    
}
