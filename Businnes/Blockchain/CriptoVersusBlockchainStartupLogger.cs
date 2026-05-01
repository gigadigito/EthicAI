using Microsoft.Extensions.Logging;

namespace BLL.Blockchain;

public static class CriptoVersusBlockchainStartupLogger
{
    public static void Log(ILogger logger, CriptoVersusBlockchainOptions options, string appName)
    {
        logger.LogInformation(
            "{AppName} blockchain mode loaded. Mode={Mode}, RpcUrl={RpcUrl}, Cluster={Cluster}, ActiveProgramId={ProgramId}, CustodyWallet={CustodyWallet}",
            appName,
            options.Mode,
            options.RpcUrl,
            options.Cluster,
            options.DescribeActiveProgram(),
            options.DescribeCustodyWallet());

        logger.LogInformation(
            "{AppName} blockchain flags. {Flags}",
            appName,
            options.DescribeFlags());
    }
}
