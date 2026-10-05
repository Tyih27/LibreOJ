#include <stdio.h>
#include <sys/types.h>
#include <unistd.h>

// Tries to spawn 64 long-lived children. When pids.max is enforced, fork fails
// and the program exits with code 7 so the test can tell the limit was hit.
int main(void)
{
    const int target = 64;
    int spawned = 0;

    for (int i = 0; i < target; i++)
    {
        pid_t pid = fork();
        if (pid == 0)
        {
            sleep(60);
            _exit(0);
        }
        if (pid < 0)
            break;
        spawned++;
    }

    if (spawned < target)
    {
        fprintf(stderr, "process limit reached after %d forks\n", spawned);
        return 7;
    }
    return 0;
}
