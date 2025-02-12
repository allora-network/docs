# How to update the knowledge base of the Allora information agent? 


### We instantiated a pinecone vector database under the name 'alloraproduction' under the Q&A chat project. Within the database, we have vectorized our data using the openai text-embedding-3-large model resulting in a database of 3072 dimension vectors.


### (example code below) We split and vectorized our text data into pinecone using langchain library below (but we could use any method as long as it adheres to the 3072 D and openai text-embedding-3-large).


pdf_path = ""
            
loader = PyMuPDFLoader(pdf_path)
docs = loader.load()  # This returns a list of Document objects

os.environ["PINECONE_API_KEY"] = ""

from langchain_text_splitters import RecursiveCharacterTextSplitter

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=250,
    chunk_overlap=50
)
split_docs = text_splitter.split_documents(docs)
os.environ["OPENAI_API_KEY"] = ""

embeddings = OpenAIEmbeddings(model="text-embedding-3-large")

#Initialize Pinecone vector store
vector_store = PineconeVectorStore.from_documents(
    split_docs,
    embedding=embeddings,
    index_name="alloraproduction"  
)

pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index("alloraproduction")

vector_store = PineconeVectorStore(embedding=embeddings, index=index)

### chunk_size and chunk_overlap are hyperparameters that are set depending on how detailed you want the data to be represented when it gets searched

### After completing this step and putting our new data embeddings into our pinecone database, it will automatically pull from new information 
