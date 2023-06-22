const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
const crypto = require('crypto');

const secret = process.env.FILE_SECRET;
const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cache = require('memory-cache');
const CACHE_KEY = 'products';
const app = express();
const JSONdb = require('simple-json-db');
const dbPlugins = new JSONdb('./plugins.json');
const dbThemes = new JSONdb('./themes.json');
const db = new JSONdb('./db.json');
db.JSON({});
// Enable Cross Origin Resource Sharing to all origins by default
app.use(cors());

// Protect against well known vulnerabilities by setting HTTP headers appropriately
app.use(helmet());

// Parse incoming request bodies in a middleware before your handlers, available under the req.body property
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// HTTP request logger middleware for Node.js
app.use(morgan('dev'));

// Attempt to compress response bodies for all requests that traverse through the middleware
app.use(compression());

const api = new WooCommerceRestApi({
  url: process.env.WC_URL,
  consumerKey: process.env.WC_CONSUMER_KEY,
  consumerSecret: process.env.WC_CONSUMER_SECRET,
  version: 'wc/v3',
  userAgent: process.env.USER_AGENT,
});

const search = [];
const formatProduct = (product) => {
  const getProductMeta = (key) => product.meta_data.find((meta) => meta.key === key)?.value;
  const image = product.images[0]?.src || '';

  let productData = {
    name: product.name,
    version: getProductMeta('product-version'),
    image,
    description: product.description,
    permalink: product.permalink,
    demoLink: getProductMeta('demo-link'),
    lastUpdate: product.date_modified_gmt,
    free: getProductMeta('is-free'),
    productID: product.id,
    brand: getProductMeta('brand'),
    categories: product.categories.map((category) => {
      return {
        name: category.name,
        slug: category.slug
      }
    }),

    popular: getProductMeta('popular'),
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    tags: product.tags.map(tag => tag.name),
    popular: getProductMeta('popular'),
    developer: getProductMeta('developer'),
    'demo-url': getProductMeta('demo-url'),
    'dev-url': getProductMeta('dev-url'),
  };
  if (product.categories.some(category => category.slug === 'wp-gpl-themes')) {
    productData.type = 'theme'
    dbThemes.set(productData.productID, productData);
  }
  if (product.categories.some(category => category.slug === 'wp-gpl-plugins')) {
    productData.type = 'plugin'
    dbPlugins.set(productData.productID, productData);
  }
  search.push({
    productID: productData.productID,
    name: productData.name,
    category: productData.description,
    type: productData.type,
    image:productData.image
  });
  return productData
};
const fetchData = async (type = '') => {
  if (type === 'plugins') {
    return dbPlugins.JSON();
  }
  if (type === 'themes') {
    return dbThemes.JSON();
  }
  return db.JSON();
};

app.get('/', async (req, res) => {
  try {
    const data = await fetchData(); // Pass 25 as the argument to limit the number of products
    res.json(data);
  } catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const Fuse = require('fuse.js');

app.post('/link/:productID', async (req, res) => {
  try {
    const productID = req.params.productID;
    const axios = require('axios');

    // Define the endpoint URL
    const endpointURL = process.env.ENDPOINT_URL + '/wp-json/wpnova/v1/products_link';

    // Define the API key
    const apiKey = req.body.api_key; // Replace with your actual API key

    // Define the request headers
    const headers = {
      'Content-Type': 'text/plain',
      'X-Api-Key': apiKey
    };

    // Make the POST request
    axios({
      method: 'post', headers: headers,
      url: endpointURL
    })
      .then(response => {
        if (response.data === true) {
          // Handle the successful response
          getProductDownloads(productID).then(response => {
            res.json({
              url: response
            })
          });

        } else {
          // Handle non-200 responses
          res.status(response.status).json({ error: 'An error occurred.' });
        }
      })
      .catch(error => {
        // Handle the error
        console.error(error);
      });


  } catch (error) {
    console.log('Failed to authenticate user: ' + error);
  }
});
async function getProductDownloads(productId) {
  try {
    const response = await api.get(`products/${productId}`);
    const product = response.data;
    console.log(product.downloads)
    return product.downloads[0].file;
  } catch (error) {
    console.error('Error retrieving product downloads:', error);
    throw error;
  }
}

app.get('/themes', async (req, res) => {
  const query = req.query.q;

  try {
    const data = await fetchData('themes');

    const options = {
      keys: ['name', 'description'],
    };

    const fuse = new Fuse(data, options);
    const results = fuse.search(query);

    const slicedResults = results.slice(0, 20); // Return only the first 20 results

    res.json(slicedResults.map(result => result.item));
  } catch (err) {
    console.error('Error searching data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/plugins', async (req, res) => {
  const query = req.query.q;

  try {
    const data = await fetchData('plugins');

    const options = {
      keys: ['name', 'description'],
    };

    const fuse = new Fuse(data, options);
    const results = fuse.search(query);

    const slicedResults = results.slice(0, 20); // Return only the first 20 results

    res.json(slicedResults.map(result => result.item));
  } catch (err) {
    console.error('Error searching data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/search', async (req, res) => {
  const query = req.query.q;
  const type = req.query.type;
  try {
    const data = await fetchData(type);

    const options = {
      keys: ['name', 'description'],
    };

    const fuse = new Fuse(data, options);
    const results = fuse.search(query);

    const slicedResults = results.slice(0, 20); // Return only the first 20 results

    res.json(slicedResults.map(result => result.item));
  } catch (err) {
    console.error('Error searching data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/:productID', async (req, res) => {
  const productID = req.params.productID;
  try {
    const data = async () => {
      // Define and initialize the 'search' variable appropriately

      // Apply filtering logic using the 'search' variable
      const filteredData = search.filter(product => {
        // Replace 'property' with the appropriate property to compare with 'productID'
        return product.productID === productID;
      });

      // Define and initialize the 'type' variable appropriately

      // Return the data based on the 'type' and 'productID'
      if (filteredData.type === 'plugins') {
        return dbPlugins.JSON(productID);
      }
      if (filteredData.type === 'themes') {
        return dbThemes.get(productID);
      }

      // If 'type' doesn't match 'plugins' or 'themes', you might want to handle this case
      // and provide an appropriate response or error message.

      // Respond with the filtered data
      return filteredData;
    };

    // Call the 'data' function and wait for it to resolve
    const result = await data();
    res.json(result);
  } catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT || 3000}`);
});

// Fetch all products at startup and every 24 hours
const fetchAllProducts = async () => {//
  let page = 1;
  let productsData = [];

  while (true) {
    try {
      const response = await api.get('products', { per_page: 100, page });
      if (response.data.length === 0) break;
      const formattedProducts = response.data.map(formatProduct)
      productsData = productsData.concat(formattedProducts);
      page += 1;
      await new Promise(resolve => setTimeout(resolve, 3000)); // Add a delay of 3000 milliseconds
    } catch (error) {
      console.error('Error fetching products:', error);
      break;
    }
  }
  console.log('Finished')
  db.JSON(search);

};

fetchAllProducts()