# Manual External UAT Observations (Authoritative)

Source: Post-Stage-20 Windows manual UAT on installed EXE SHA `058626db3bdc1f632bef49fc0fa6862cc76fb34ded26293251501d022bd376c0`.

1. Bootstrap window smaller than content; left-side clipping (RTL).
2. Google OAuth succeeded but red errors appeared in Bootstrap checklist.
3. No practical Google disconnect / account switch after connect.
4. Discovery found organization, branches, license, cloud data.
5. Branch recovery UI showed `BR-MAIN` instead of discovered branches.
6. User completed device naming and binding, reached restore.
7. Rescan button non-responsive despite prior successful discovery.
8. User chose Start New (empty database path).
9. Reached owner confirmation but could not confirm/create/restore/continue.
10. Back button inconsistent / non-responsive.
11. After navigation, multiple cloud backup versions appeared in restore.
12. User selected cloud backup and started Restore.
13. Restore stalled around 21% while time continued.
14. Mid-journey Bootstrap returned to Google step claiming Google not connected.

Real Google OAuth: EXECUTED — SUCCESS  
Real Discovery: EXECUTED — SUCCESS  
Google persistence through bootstrap: EXECUTED — FAIL  
Account switching: EXECUTED — FAIL / unavailable  
Branch recovery: EXECUTED — FAIL (BR-MAIN)  
Cloud restore: EXECUTED — FAIL (~21% stall)  
Full journey: FAIL
