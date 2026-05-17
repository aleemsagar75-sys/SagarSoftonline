# SagarSoft Online Setup

## 1. Supabase

Tables are created automatically by the Render backend when it starts.

You need the Supabase database connection string:

`Supabase Dashboard > Project Settings > Database > Connection string`

Use the direct connection string and replace `[YOUR-PASSWORD]` with the database password.

## 2. Render Environment Variables

Create a new Render Web Service from the GitHub repo and use:

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

Add these environment variables in Render:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`
- `SAGARSOFT_API_KEY`
- `DEFAULT_SCHOOL_ID`

Do not put secret keys in frontend files.

## 3. Connect Desktop App To Render

After Render gives you the backend URL, open:

`js/online-config.js`

Set:

```js
window.SagarSoftOnlineConfig = {
  apiBaseUrl: "https://your-render-service.onrender.com",
  apiKey: "same-value-as-SAGARSOFT_API_KEY",
  schoolId: "SCH-2026-001"
};
```

## 4. Create First School License

Use the Render backend endpoint:

`POST /api/admin/license`

Headers:

- `Content-Type: application/json`
- `x-sagarsoft-api-key: your SAGARSOFT_API_KEY`

Body example:

```json
{
  "school_id": "SCH-2026-001",
  "school_name": "SagarSoft Public School",
  "email": "school@example.com",
  "password": "school-password",
  "status": "active",
  "plan": "monthly",
  "expiry_date": "2026-12-31"
}
```

After that, school admin can login with that email and password.
