: Poor man's log-rolling checkpointer. Paranoia is not enough.
rmdir /s ..\BACKUP_new-sounds-on-demand-9
ren ..\BACKUP_new-sounds-on-demand-8 BACKUP_new-sounds-on-demand-9
ren ..\BACKUP_new-sounds-on-demand-7 BACKUP_new-sounds-on-demand-8
ren ..\BACKUP_new-sounds-on-demand-6 BACKUP_new-sounds-on-demand-7
ren ..\BACKUP_new-sounds-on-demand-5 BACKUP_new-sounds-on-demand-6
ren ..\BACKUP_new-sounds-on-demand-4 BACKUP_new-sounds-on-demand-5
ren ..\BACKUP_new-sounds-on-demand-3 BACKUP_new-sounds-on-demand-4
ren ..\BACKUP_new-sounds-on-demand-2 BACKUP_new-sounds-on-demand-3
ren ..\BACKUP_new-sounds-on-demand   BACKUP_new-sounds-on-demand-2
xcopy /s .\* ..\BACKUP_new-sounds-on-demand\
