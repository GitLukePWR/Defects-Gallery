# Survport – Structural Survey Reporting

*Survey + Report.*

A home-screen web app for bridge and structural inspections. Photos, plan
drawings and records are stored as files in a **private folder on the device**
(the browser's Origin Private File System). Nothing is uploaded; there are no
accounts, servers, analytics or third-party SDKs.

## Features
- Camera capture or library import; GPS read from photo metadata, with the
  phone's location used as a fallback for camera shots
- Camera shots can be copied to the iPhone Photos app: tap **Save to Photos**
  after taking one (or the "Save N camera photos to Photos" button on the
  Photos tab), then **Save Image** in the share sheet. iOS doesn't let web
  apps write to Photos without that tap, so it can't happen automatically
- 43 bridge elements (CS 450 / Inspection Manual element breakdown) and 13
  defect categories plus a "record only" option; photo list grouped by element
- Plan drawings from images or PDFs (each PDF page becomes a plan); pinch-zoom,
  tap to place a numbered marker, drag to set the direction you were facing
- Map of geotagged photos (offline grid by default; online base map is opt-in)
- PDF and Word reports include each plan with its numbered markers and a
  marker key (switch off on the Export tab), and each photo caption names its plan
- Exports: PDF report (1/2/4/6 per page + quality slider), Word .docx with
  auto-numbering captions, annotated plans PDF with marker key, single-file
  interactive HTML plan viewer (search by photo number), .zip backup package
- Create, rename, duplicate, delete, export and import inspections
- Light and dark mode; works fully offline after first load

## Folder layout on the device
Everything lives under its own `survport/` folder, separate from any other app
served from the same site (e.g. another GitHub Pages repo on the same account).
```
survport/inspections/<id>/inspection.json   all records
survport/inspections/<id>/photos/           original photo files, untouched
survport/inspections/<id>/thumbs/           small previews
survport/inspections/<id>/plans/            plan drawing pages
```

## Putting it on your iPhone
It must be served once over HTTPS so iOS will install it and allow on-device
storage. GitHub Pages is the simplest free option:

1. Create a new GitHub repository (it can be private if your plan allows Pages
   on private repos; the app code contains no data either way).
2. Upload the contents of this folder (index.html at the top level).
3. Settings → Pages → Deploy from branch → `main` / root.
4. On the iPhone, open the Pages URL in **Safari** → Share → **Add to Home
   Screen**. Always open it from the Home Screen icon.

After the first load it runs entirely offline. Your inspection data never goes
to GitHub – only the app's code is hosted there.

## Important notes on data safety
- Home-screen apps on iOS are exempt from Safari's automatic 7-day storage
  clean-up; a plain Safari tab is not. Use the Home Screen icon.
- Removing the Home Screen app, or Settings → Safari → Clear History and
  Website Data, deletes its folder. **Export a .zip package regularly.**
- The folder is private to the app, so it doesn't appear in the Files app;
  use Export to move anything out.
- Private Browsing blocks on-device storage.

## Taking photos
After each camera shot the photo opens with a green "saved" banner: it's
already stored in the inspection, and element, category and description save
as you type. Tap **Done** to go back to the list, or **Take next** to go
straight back to the camera.

## Updating
Change `VERSION` in `sw.js` whenever you change any file, so installed copies
pick up the new version.
