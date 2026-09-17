# SagarSoft Production Roadmap

## Current Production Foundation

- Render API is the online backend.
- Supabase stores school license/control data.
- `school_databases` stores the complete per-school software database as JSON.
- `app_records` mirrors module-wise records for searching/reporting.
- `students`, `classes`, `employees`, and `teachers` mirror common module data.
- Mirror tables now include `school_id` and `source_id`, so schools remain isolated.

## Before Marketing

1. Deploy latest backend changes from `server/server.js`.
2. Confirm every school has a unique `school_id`.
3. Test these flows for at least two schools:
   - add/edit student
   - add/edit employee
   - add/edit class
   - fee invoice and collection
   - salary paid slip
   - exam/question paper
   - control panel active/inactive/blocked
   - expiry lock
4. Move large images/photos to Supabase Storage in the next backend phase.
5. Rebuild the desktop installer after online config is final.

## Mobile App Plan

Recommended stack: Expo React Native.

Backend access should stay through Render API, not direct Supabase keys.

Mobile modules:

- Auth and school selection
- Dashboard
- Students
- Employees
- Classes and subjects
- Attendance
- Fees
- Salary
- Exams
- Question paper/question bank
- Reports
- Certificates
- Notifications
- Settings/Profile

Suggested order:

1. Build mobile API endpoints over existing `school_databases` and `app_records`.
2. Scaffold Expo app.
3. Add auth and school-scoped sync.
4. Add read-only modules first.
5. Add create/edit flows module by module.
6. Build APK for testing.
