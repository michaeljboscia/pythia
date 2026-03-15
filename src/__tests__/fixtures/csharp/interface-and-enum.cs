public interface IRepository<T>
{
    T GetById(int id);
    void Save(T entity);
    void Delete(int id);
}

public enum UserStatus
{
    Active,
    Inactive,
    Suspended
}
