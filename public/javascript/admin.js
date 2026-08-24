document.addEventListener("click", async function (e) {

    const link = e.target.closest(".admin-page-link");

    if (!link) return;

    e.preventDefault();

    const url = link.getAttribute("href");

    try {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Failed to load page");
        }

        const html = await response.text();

        document.querySelector("#admin-content").innerHTML = html;

    } catch (error) {

        console.error(error);

        document.querySelector("#admin-content").innerHTML =
        "<p>Something went wrong while loading the page.</p>";
    }
});