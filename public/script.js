document.getElementById("login-btn").addEventListener("click", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("login-btn");
    const originalText = btn.innerHTML;
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    btn.innerHTML = 'Signing In...';
    btn.disabled = true;

    try {
        const response = await fetch("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            window.location.href = data.redirect;
        } else {
            btn.innerHTML = originalText;
            btn.disabled = false;
            alert("Invalid Username or Password");
        }
    } catch (error) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        alert("An error occurred during login.");
    }
});
function togglePasswordVisibility() {
    const passwordInput = document.getElementById("password");
    const toggleText = document.querySelector(".toggle-password");

    if (passwordInput.type === "password") {
        passwordInput.type = "text";
        toggleText.textContent = "Hide";
    } else {
        passwordInput.type = "password";
        toggleText.textContent = "Show";
    }
}