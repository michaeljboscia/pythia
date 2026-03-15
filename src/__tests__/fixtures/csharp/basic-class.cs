namespace MyApp;

public class UserService
{
    private readonly string _connectionString;

    public UserService(string connectionString)
    {
        _connectionString = connectionString;
    }

    public string GetUser(int id)
    {
        return $"user_{id}";
    }

    public bool DeleteUser(int id)
    {
        return true;
    }
}
