window.html5Toast = {
    show: function (message, type, duration) {
        const toast = document.getElementById('html5-toast');
        const toastText = document.getElementById('html5-toast-text');

        if (toast && toastText) {
            // Para qualquer animação anterior
            toast.style.animation = 'none';
            toast.offsetHeight; // força reflow do DOM

            // Reset da classe base
            toast.className = 'toast-message';

            // Adiciona tipo (success, error, info)
            switch (type) {
                case 'success':
                    toast.classList.add('toast-success');
                    break;
                case 'error':
                    toast.classList.add('toast-error');
                    break;
                case 'info':
                default:
                    toast.classList.add('toast-info');
                    break;
            }

            toastText.textContent = message;
            toast.style.display = 'block';

            // Reaplica a animação de entrada
            toast.style.animation = 'slide-in 0.4s ease-out forwards';

            // Aguarda a duração, depois inicia animação de saída
            setTimeout(() => {
                toast.style.animation = 'slide-out 0.4s ease-in forwards';

                // Após a animação de saída, esconde o toast
                setTimeout(() => {
                    toast.style.display = 'none';
                }, 400); // duração do slide-out
            }, duration || 3000);
        }
    }
};
