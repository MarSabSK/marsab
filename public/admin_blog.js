(async function () {

  const titleInput = document.getElementById("title");
  const editor = document.getElementById("editor");
  const imageInput = document.getElementById("imageInput");
  const saveBtn = document.getElementById("saveBtn");
  const blogList = document.getElementById("blogList");

  async function loadBlogs() {
    const res = await fetch("/api/blog");
    const blogs = await res.json();

    blogList.innerHTML = "";

    blogs.forEach(blog => {
      const div = document.createElement("div");
      div.className = "blog-item";

      div.innerHTML = `
        <h3>${blog.title}</h3>
        <div class="small">${new Date(blog.createdAt).toLocaleString("sk-SK")}</div>
        ${blog.imageUrl ? `<img src="${blog.imageUrl}" style="max-width:200px; display:block; margin:10px 0;">` : ""}
        <button data-id="${blog._id}">Vymazať</button>
      `;

      div.querySelector("button").addEventListener("click", async () => {
        await fetch("/api/admin/blog/" + blog._id, {
          method: "DELETE"
        });
        loadBlogs();
      });

      blogList.appendChild(div);
    });
  }

  saveBtn.addEventListener("click", async () => {
    const fd = new FormData();
    fd.append("title", titleInput.value);
    fd.append("content", editor.innerHTML);

    if (imageInput.files[0]) {
      fd.append("image", imageInput.files[0]);
    }

    await fetch("/api/admin/blog", {
      method: "POST",
      body: fd
    });

    titleInput.value = "";
    editor.innerHTML = "";
    imageInput.value = "";

    loadBlogs();
  });

  loadBlogs();

})();