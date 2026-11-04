-- v5: hashtags replace project groups (status already covers 할 일 / 진행 중). Safe to re-run.
alter table public.tasks add column if not exists tags text[] not null default '{}';
create index if not exists tasks_tags_idx on public.tasks using gin (tags);
update public.tasks set group_id = null where group_id is not null;
delete from public.project_groups;
