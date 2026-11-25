-- Mini-Blog look: page background (around the content box) and a button color separate from the link color.
-- Both optional: null keeps the theme's background and buttons in the link color, so nothing changes for existing Mini-Blogs.
ALTER TABLE "text_sites" ADD COLUMN "page_bg" TEXT;
ALTER TABLE "text_sites" ADD COLUMN "button_color" TEXT;
